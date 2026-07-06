#!/usr/bin/env node
/**
 * Recommend a default runner SKU per (workflow, job) from a GitHub Actions
 * usage-data CSV export.
 *
 * The CSV is the standard "Usage data > Export" file:
 *   Job, Workflow, Source repository, Failure rate, Avg run time (ms),
 *   Avg queue time (ms), Runner type, Runner labels, Job runs
 *
 * Why this is non-trivial:
 *   The CSV mixes runs from heterogeneous runner pools (GitHub-hosted,
 *   zupit-agents, warpbuild, buildjet, …) with different vCPU counts and
 *   different single-thread speeds. Wall time alone is not comparable.
 *   We normalize each sample to "github-equivalent seconds on a 2-vCPU
 *   ubuntu-latest runner" and then pick the smallest SKU that brings wall
 *   time under a target threshold (default 4 minutes). This bakes in the
 *   billing model "double vCPU = double cost" -> only upsize if necessary.
 *
 * Caveats:
 *   - We only have wall time. Without CPU% we assume near-linear scaling.
 *     That is true for CPU-bound jobs (build/test/sonar in our profiling)
 *     and conservative for IO-bound ones (we may over-allocate; pair with
 *     warpbuild-analysis on real instance metrics before committing big bumps).
 *   - vCPU for zupit-agents is unknown from the label; pass --vcpu-zupit.
 *   - GH hosted ubuntu defaults to 2 vCPU (free org tier). Override with
 *     --vcpu-gh-default if your org runs 4-vCPU larger runners.
 *
 * Usage:
 *   npx tsx tools/runner-sizing/analyze.ts <input.csv> [options]
 */

import { readFileSync, writeFileSync } from "fs";
import { basename, extname, resolve } from "path";

// ---------------------------------------------------------------------------
// CLI

type Family = "warp" | "buildjet" | "zupit-agents" | "gh-hosted" | "other";

interface Options {
  input: string;
  output: string;
  writeMd: boolean;
  vcpuZupit: number;
  vcpuGhDefault: number;
  targetWallSec: number;
  shortThresholdSec: number;
  minRuns: number;
  speedWarp: number;
  speedBuildjet: number;
  speedZupit: number;
  /** Runner family the recommendation should target. Drives wall-time math
   *  and the recommended SKU label. */
  targetFamily: Family;
  /** Drop samples whose normalised baseline is > this factor × the group's
   *  median baseline. 0 disables. */
  outlierFactor: number;
  /** Drop samples whose failure_rate (in percent) is strictly greater than
   *  this threshold. 100 disables. */
  dropFailureAbove: number;
  /** Minimum samples in a group before outlier removal applies. Below this
   *  the median is too noisy to use as a reference. */
  outlierMinSamples: number;
}

function parseArgs(argv: string[]): Options {
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    printHelp();
    process.exit(argv.length === 0 ? 1 : 0);
  }

  const opts: Options = {
    input: "",
    output: "",
    writeMd: true,
    vcpuZupit: 4,
    vcpuGhDefault: 2,
    targetWallSec: 240,
    shortThresholdSec: 60,
    minRuns: 1,
    speedWarp: 0.42,
    speedBuildjet: 0.318,
    speedZupit: 0.2684,
    targetFamily: "warp",
    outlierFactor: 3.0,
    dropFailureAbove: 80,
    outlierMinSamples: 4,
  };

  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--output":
        opts.output = next();
        break;
      case "--no-md":
        opts.writeMd = false;
        break;
      case "--vcpu-zupit":
        opts.vcpuZupit = Number(next());
        break;
      case "--vcpu-gh-default":
        opts.vcpuGhDefault = Number(next());
        break;
      case "--target-wall-sec":
        opts.targetWallSec = Number(next());
        break;
      case "--short-threshold":
        opts.shortThresholdSec = Number(next());
        break;
      case "--min-runs":
        opts.minRuns = Number(next());
        break;
      case "--speed-warp":
        opts.speedWarp = Number(next());
        break;
      case "--speed-buildjet":
        opts.speedBuildjet = Number(next());
        break;
      case "--speed-zupit":
        opts.speedZupit = Number(next());
        break;
      case "--target-family": {
        const v = next();
        if (!["warp", "buildjet", "zupit-agents", "gh-hosted"].includes(v)) {
          console.error(`Invalid --target-family: ${v}`);
          process.exit(2);
        }
        opts.targetFamily = v as Family;
        break;
      }
      case "--outlier-factor":
        opts.outlierFactor = Number(next());
        break;
      case "--drop-failure-above":
        opts.dropFailureAbove = Number(next());
        break;
      case "--outlier-min-samples":
        opts.outlierMinSamples = Number(next());
        break;
      default:
        if (a.startsWith("--")) {
          console.error(`Unknown option: ${a}`);
          process.exit(2);
        }
        positional.push(a);
    }
  }

  if (positional.length !== 1) {
    console.error("Expected exactly one positional argument: the CSV path.");
    process.exit(2);
  }
  opts.input = positional[0];
  if (!opts.output) {
    const base = basename(opts.input, extname(opts.input));
    opts.output = resolve(opts.input, "..", `${base}-sizing`);
  } else {
    opts.output = resolve(opts.output);
  }
  return opts;
}

function printHelp(): void {
  console.log(`runner-sizing/analyze.ts — recommend per-job default runner SKU

Usage:
  npx tsx tools/runner-sizing/analyze.ts <input.csv> [options]

Options:
  --output <path>        Base output path; writes <path>.json and <path>.md
                         (default: <input-basename>-sizing alongside the CSV)
  --no-md                Skip markdown output
  --vcpu-zupit <n>       vCPU count assumed for zupit-agents runners      (default 4)
  --vcpu-gh-default <n>  vCPU for github-hosted ubuntu-latest             (default 2)
  --target-wall-sec <n>  Target wall time (s) for recommended SKU         (default 240)
  --short-threshold <n>  Wall seconds under which job is "trivial" -> 2x  (default 60)
  --min-runs <n>         Drop (workflow,job,sku) groups below N runs      (default 1)
  --speed-warp <n>       Warpbuild speedup vs gh (fraction faster)        (default 0.42)
  --speed-buildjet <n>   BuildJet speedup vs gh (fraction faster)         (default 0.318)
  --speed-zupit <n>      zupit-agents speedup vs gh (fraction faster)     (default 0.2684)
  --target-family <fam>  Runner family the recommendation should target   (default warp)
                         One of: warp | buildjet | zupit-agents | gh-hosted.
                         Drives the SKU label and the wall-time math (a faster family
                         needs less vCPU to hit the same target wall time).
  --outlier-factor <n>   Drop samples > N × group median baseline; 0 disables (default 3.0)
  --drop-failure-above <p>  Drop samples with failure_rate% > p; 100 disables  (default 80)
  --outlier-min-samples <n> Min samples in a group for outlier filter to engage (default 4)
  -h, --help             Print this help`);
}

// ---------------------------------------------------------------------------
// CSV parsing
//
// The GitHub usage export wraps every text field in extra quotes and prefixes
// the value with a single quote to force-cast it to text in Excel. After
// RFC4180 decoding a cell looks like  `'foo`  — we strip the leading apostrophe.

function parseCsv(raw: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inQuotes) {
      if (ch === '"') {
        if (raw[i + 1] === '"') {
          cur += '"';
          i++;
        } // escaped quote
        else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") {
        row.push(cur);
        cur = "";
      } else if (ch === "\n") {
        row.push(cur);
        cur = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else if (ch === "\r") {
        // ignore
      } else {
        cur += ch;
      }
    }
  }
  if (cur !== "" || row.length > 0) {
    row.push(cur);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  // Excel-prefix hack: cells arrive as `"'value"` after RFC4180 decoding.
  // Strip the wrapping literal `"` and the leading apostrophe.
  return rows.map((r) =>
    r.map((c) => {
      let v = c;
      if (v.startsWith('"')) v = v.slice(1);
      if (v.endsWith('"')) v = v.slice(0, -1);
      if (v.startsWith("'")) v = v.slice(1);
      return v;
    }),
  );
}

// ---------------------------------------------------------------------------
// Runner classification

interface RunnerInfo {
  family: Family;
  sku: string; // canonical name we can paste back into yml
  vcpu: number;
}

function classifyRunner(labels: string, opts: Options): RunnerInfo {
  const tokens = labels
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // Prefer the most specific label. The "self-hosted" / "hosted" generic tag
  // is always present; ignore it.
  const meaningful = tokens.filter((t) => t !== "self-hosted" && t !== "hosted");
  const pick = meaningful[0] || tokens[0] || "unknown";

  // warp-ubuntu-latest-x64-Nx
  const warpMatch = pick.match(/^warp-ubuntu-latest-x64-(\d+)x$/);
  if (warpMatch) {
    return { family: "warp", sku: pick, vcpu: Number(warpMatch[1]) };
  }
  // buildjet-Nvcpu-ubuntu-XX.YY  (forward-compat; not present in current export)
  const bjMatch = pick.match(/^buildjet-(\d+)vcpu/);
  if (bjMatch) {
    return { family: "buildjet", sku: pick, vcpu: Number(bjMatch[1]) };
  }
  if (pick === "zupit-agents") {
    return { family: "zupit-agents", sku: pick, vcpu: opts.vcpuZupit };
  }
  if (/^ubuntu-/.test(pick)) {
    return { family: "gh-hosted", sku: pick, vcpu: opts.vcpuGhDefault };
  }
  if (/^(macos|windows)-/.test(pick)) {
    // out of scope for the warpbuild/zupit defaults; flag and skip later
    return { family: "other", sku: pick, vcpu: opts.vcpuGhDefault };
  }
  return { family: "other", sku: pick, vcpu: opts.vcpuGhDefault };
}

function speedFactor(fam: Family, opts: Options): number {
  // Multiplier to convert wall time on this family into the equivalent wall
  // time on a github-hosted runner with the same vCPU count.
  // -X% means the family is X% faster -> divide by (1 - X/100).
  switch (fam) {
    case "warp":
      return 1 / (1 - opts.speedWarp);
    case "buildjet":
      return 1 / (1 - opts.speedBuildjet);
    case "zupit-agents":
      return 1 / (1 - opts.speedZupit);
    case "gh-hosted":
      return 1;
    case "other":
      return 1;
  }
}

// ---------------------------------------------------------------------------
// Per-row sample + per-job aggregation

interface RawRow {
  job: string;
  workflow: string;
  repository: string;
  failureRate: number;
  avgRunMs: number;
  avgQueueMs: number;
  runnerType: string;
  runnerLabels: string;
  runs: number;
}

interface Sample {
  family: Family;
  sku: string;
  vcpu: number;
  runs: number;
  avgWallSec: number;
  failureRate: number;
  /** Wall time normalised to a github 2-vCPU runner, assuming linear scaling. */
  normGh2vcpuSec: number;
  /** When the sample was excluded from aggregation. Empty when kept. */
  excludedReason?: string;
  /** Repository the sample comes from (for outlier triage). */
  repository: string;
  /** Workflow short name (for outlier triage). */
  workflow: string;
  /** Job name (for outlier triage). */
  job: string;
}

interface JobGroup {
  workflow: string;
  job: string;
  repositories: string[];
  samples: Sample[];
  totalRuns: number;
  /** Weighted average of the normalised baseline across kept samples. */
  weightedBaselineSec: number;
  /** Worst (highest) normalised baseline observed among kept samples. */
  peakBaselineSec: number;
  recommendedSku: string;
  recommendedTier: number;
  reason: string;
  flags: string[];
}

function shortWorkflow(path: string): string {
  return path.replace(/^\.github\/workflows\//, "");
}

function buildSample(row: RawRow, opts: Options): Sample | null {
  const r = classifyRunner(row.runnerLabels, opts);
  if (r.family === "other") return null;
  const wallSec = row.avgRunMs / 1000;
  const norm = wallSec * speedFactor(r.family, opts) * (r.vcpu / 2);
  return {
    family: r.family,
    sku: r.sku,
    vcpu: r.vcpu,
    runs: row.runs,
    avgWallSec: wallSec,
    failureRate: row.failureRate,
    normGh2vcpuSec: norm,
    repository: row.repository,
    workflow: shortWorkflow(row.workflow),
    job: row.job,
  };
}

/**
 * Flag samples as outliers and return them as a separate list. The samples
 * stay in `group.samples` (so the report can show them) but are excluded
 * from the weighted-baseline aggregation. Two filters:
 *   1. `failureRate * 100 > opts.dropFailureAbove` — failure-rate floor.
 *      A 90%-failing sample's wall time is dominated by short aborts and
 *      does not represent the actual workload.
 *   2. `normGh2vcpuSec > opts.outlierFactor × median(normGh2vcpuSec)` —
 *      median-factor filter. Catches bursty single-repo outliers (cold
 *      cache, mega-PR, infra hiccup) without nuking the typical signal.
 *      Requires at least `opts.outlierMinSamples` samples — below that
 *      the median is too noisy to trust.
 */
function flagOutliers(g: JobGroup, opts: Options): Sample[] {
  const dropped: Sample[] = [];
  for (const s of g.samples) {
    if (opts.dropFailureAbove < 100 && s.failureRate > opts.dropFailureAbove) {
      s.excludedReason = `failure_rate=${s.failureRate.toFixed(1)}% > ${opts.dropFailureAbove}%`;
      dropped.push(s);
    }
  }
  if (opts.outlierFactor > 0 && g.samples.length >= opts.outlierMinSamples) {
    const eligible = g.samples.filter((s) => !s.excludedReason).map((s) => s.normGh2vcpuSec);
    if (eligible.length >= opts.outlierMinSamples) {
      const sorted = [...eligible].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      if (median > 0) {
        for (const s of g.samples) {
          if (s.excludedReason) continue;
          if (s.normGh2vcpuSec > median * opts.outlierFactor) {
            s.excludedReason = `baseline ${s.normGh2vcpuSec.toFixed(0)}s > ${opts.outlierFactor}× median ${median.toFixed(0)}s`;
            dropped.push(s);
          }
        }
      }
    }
  }
  return dropped;
}

function recommendTier(group: JobGroup, opts: Options): { tier: number; reason: string } {
  // Size for the *typical* run (weighted average across all samples), not the
  // worst one. The peak is reported separately as a flag — a job whose worst
  // run is much slower than the average is bursty, not consistently large.
  const baseline = group.weightedBaselineSec;
  const targetSpeed = speedFactor(opts.targetFamily, opts); // gh-equivalent / actual

  // Expected actual wall on `target-family` at tier N (vCPU) assuming linear
  // scaling: gh-2vcpu baseline * (2/N) / target_family_speedup.
  const wallOnTier = (tier: number) => (baseline * (2 / tier)) / targetSpeed;

  if (baseline <= opts.shortThresholdSec) {
    return {
      tier: 2,
      reason: `typical ${baseline.toFixed(1)}s on 2-vCPU gh (≈${wallOnTier(2).toFixed(1)}s on ${opts.targetFamily}-2x) <= short_threshold ${opts.shortThresholdSec}s → cheapest SKU`,
    };
  }

  let tier = 2;
  while (tier < 16) {
    if (wallOnTier(tier) <= opts.targetWallSec) break;
    tier *= 2;
  }
  return {
    tier,
    reason: `typical ${baseline.toFixed(1)}s on 2-vCPU gh → on ${opts.targetFamily}-${tier}x ~${wallOnTier(tier).toFixed(1)}s (target ≤ ${opts.targetWallSec}s)`,
  };
}

function chooseSkuLabel(tier: number, family: Family): string {
  switch (family) {
    case "warp":
      return `warp-ubuntu-latest-x64-${tier}x`;
    case "buildjet":
      return `buildjet-${tier}vcpu-ubuntu-2204`;
    case "zupit-agents":
      return `zupit-agents (${tier} vCPU class)`;
    case "gh-hosted":
      return tier <= 2 ? "ubuntu-latest" : `ubuntu-latest-${tier}-cores`;
    case "other":
      return `${tier}-vcpu`;
  }
}

// ---------------------------------------------------------------------------
// Main

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const raw = readFileSync(opts.input, "utf8");
  const rows = parseCsv(raw);
  if (rows.length === 0) {
    console.error("Empty CSV");
    process.exit(1);
  }
  const header = rows[0].map((s) => s.trim().toLowerCase());
  const idx = (name: string) => {
    const i = header.findIndex((h) => h === name.toLowerCase());
    if (i < 0) throw new Error(`Missing column: ${name}`);
    return i;
  };
  const iJob = idx("job");
  const iWf = idx("workflow");
  const iRepo = idx("source repository");
  const iFail = idx("failure rate");
  const iRun = idx("avg run time");
  const iQueue = idx("avg queue time");
  const iType = idx("runner type");
  const iLabels = idx("runner labels");
  const iRuns = idx("job runs");

  const dataRows: RawRow[] = rows.slice(1).map((r) => ({
    job: r[iJob],
    workflow: r[iWf],
    repository: r[iRepo],
    failureRate: Number(r[iFail]),
    avgRunMs: Number(r[iRun]),
    avgQueueMs: Number(r[iQueue]),
    runnerType: r[iType],
    runnerLabels: r[iLabels],
    runs: Number(r[iRuns]),
  }));

  // Group by (workflow basename, job). Aggregate samples.
  const groups = new Map<string, JobGroup>();
  for (const row of dataRows) {
    if (!row.job || !row.workflow) continue;
    if (row.runs < opts.minRuns) continue;
    const sample = buildSample(row, opts);
    if (!sample) continue; // non-linux/other runner — skip
    const wf = shortWorkflow(row.workflow);
    const key = `${wf}::${row.job}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        workflow: wf,
        job: row.job,
        repositories: [],
        samples: [],
        totalRuns: 0,
        weightedBaselineSec: 0,
        peakBaselineSec: 0,
        recommendedSku: "",
        recommendedTier: 2,
        reason: "",
        flags: [],
      };
      groups.set(key, g);
    }
    if (!g.repositories.includes(row.repository)) g.repositories.push(row.repository);
    g.samples.push(sample);
  }

  // Tag outliers BEFORE aggregation, then aggregate over kept samples only.
  // Dropped samples are kept in `group.samples` so the report can show them,
  // but they don't influence the recommendation.
  const allOutliers: Sample[] = [];
  for (const g of groups.values()) {
    const dropped = flagOutliers(g, opts);
    allOutliers.push(...dropped);
  }

  for (const g of groups.values()) {
    let weighted = 0;
    let runs = 0;
    let peak = 0;
    let failingRuns = 0;
    let totalRunsAll = 0;
    let droppedRuns = 0;
    for (const s of g.samples) {
      totalRunsAll += s.runs;
      if (s.excludedReason) {
        droppedRuns += s.runs;
        continue;
      }
      weighted += s.normGh2vcpuSec * s.runs;
      runs += s.runs;
      if (s.normGh2vcpuSec > peak) peak = s.normGh2vcpuSec;
      if (s.failureRate > 0) failingRuns += s.runs * (s.failureRate / 100);
    }
    g.totalRuns = runs;
    g.weightedBaselineSec = runs > 0 ? weighted / runs : 0;
    g.peakBaselineSec = peak;
    const rec = recommendTier(g, opts);
    g.recommendedTier = rec.tier;
    g.recommendedSku = chooseSkuLabel(rec.tier, opts.targetFamily);
    g.reason = rec.reason;
    if (runs > 0 && failingRuns / runs > 0.1) {
      g.flags.push(`high_failure_share=${((failingRuns / runs) * 100).toFixed(1)}%`);
    }
    if (g.samples.every((s) => s.family === "zupit-agents")) {
      g.flags.push("only-observed-on=zupit-agents (no warp profile yet)");
    }
    if (g.totalRuns < 5) {
      g.flags.push(`low-sample N=${g.totalRuns}`);
    }
    if (g.weightedBaselineSec > 0 && g.peakBaselineSec / g.weightedBaselineSec >= 2.5) {
      g.flags.push(
        `bursty peak/typical=${(g.peakBaselineSec / g.weightedBaselineSec).toFixed(1)}x (peak ${g.peakBaselineSec.toFixed(0)}s)`,
      );
    }
    if (droppedRuns > 0) {
      g.flags.push(`outliers_dropped=${droppedRuns}/${totalRunsAll} runs`);
    }
  }

  // If a group lost all its samples to outlier filtering, recommendation is
  // not meaningful — keep it in the output but mark it.
  for (const g of groups.values()) {
    if (g.totalRuns === 0) {
      g.flags.push("all-samples-excluded");
      g.recommendedSku = "(no recommendation)";
      g.reason = "every sample was filtered out by --outlier-factor / --drop-failure-above";
    }
  }

  // Sort: by recommended tier desc, then by total runs desc.
  const sorted = [...groups.values()].sort((a, b) => {
    if (b.recommendedTier !== a.recommendedTier) return b.recommendedTier - a.recommendedTier;
    return b.totalRuns - a.totalRuns;
  });

  // Write JSON.
  const jsonOut = {
    options: opts,
    generatedAt: new Date().toISOString(),
    inputRows: dataRows.length,
    groupCount: sorted.length,
    groups: sorted.map((g) => ({
      workflow: g.workflow,
      job: g.job,
      repositories: g.repositories,
      totalRuns: g.totalRuns,
      weightedBaselineSec: round(g.weightedBaselineSec),
      peakBaselineSec: round(g.peakBaselineSec),
      recommendedSku: g.recommendedSku,
      recommendedTier: g.recommendedTier,
      reason: g.reason,
      flags: g.flags,
      samples: g.samples.map((s) => ({
        family: s.family,
        sku: s.sku,
        vcpu: s.vcpu,
        runs: s.runs,
        avgWallSec: round(s.avgWallSec),
        failureRate: s.failureRate,
        normGh2vcpuSec: round(s.normGh2vcpuSec),
        excludedReason: s.excludedReason ?? null,
      })),
    })),
  };
  writeFileSync(`${opts.output}.json`, JSON.stringify(jsonOut, null, 2));
  console.log(`Wrote ${opts.output}.json (${sorted.length} groups)`);

  // Dedicated outliers file: every dropped sample with its group context, so
  // a human can decide whether it's a real signal (slow repo, big PR) or
  // genuine noise (failed CI, infra hiccup).
  const outlierRows = allOutliers
    .slice()
    .sort((a, b) => b.normGh2vcpuSec - a.normGh2vcpuSec)
    .map((s) => ({
      workflow: s.workflow,
      job: s.job,
      repository: s.repository,
      family: s.family,
      sku: s.sku,
      vcpu: s.vcpu,
      runs: s.runs,
      avgWallSec: round(s.avgWallSec),
      failureRate: s.failureRate,
      normGh2vcpuSec: round(s.normGh2vcpuSec),
      reason: s.excludedReason,
    }));
  writeFileSync(
    `${opts.output}-outliers.json`,
    JSON.stringify(
      {
        count: outlierRows.length,
        filter: {
          outlierFactor: opts.outlierFactor,
          dropFailureAbove: opts.dropFailureAbove,
          outlierMinSamples: opts.outlierMinSamples,
        },
        rows: outlierRows,
      },
      null,
      2,
    ),
  );
  console.log(`Wrote ${opts.output}-outliers.json (${outlierRows.length} samples)`);
  if (opts.writeMd) {
    writeFileSync(`${opts.output}-outliers.md`, renderOutliersMd(outlierRows, opts));
    console.log(`Wrote ${opts.output}-outliers.md`);
  }

  // Aggregate by trailing job-ID so the report also surfaces a recommended
  // default per *pipeline-templates step* (the same job ID is reused across
  // many consumer workflows/repos).
  const byLeaf = new Map<string, JobGroup[]>();
  for (const g of sorted) {
    const leaf =
      g.job
        .split("/")
        .map((s) => s.trim())
        .filter(Boolean)
        .pop() ?? g.job;
    const arr = byLeaf.get(leaf) ?? [];
    arr.push(g);
    byLeaf.set(leaf, arr);
  }
  interface LeafAgg {
    jobId: string;
    consumers: number;
    totalRuns: number;
    weightedBaselineSec: number;
    peakBaselineSec: number;
    recommendedTier: number;
    recommendedSku: string;
    reason: string;
    repos: string[];
    families: string[];
  }
  const leafRows: LeafAgg[] = [];
  for (const [leaf, arr] of byLeaf) {
    let totalRuns = 0;
    let weighted = 0;
    let peak = 0;
    const repos = new Set<string>();
    const families = new Set<string>();
    for (const g of arr) {
      totalRuns += g.totalRuns;
      weighted += g.weightedBaselineSec * g.totalRuns;
      if (g.peakBaselineSec > peak) peak = g.peakBaselineSec;
      g.repositories.forEach((r) => repos.add(r));
      g.samples.forEach((s) => families.add(s.family));
    }
    const baseline = totalRuns > 0 ? weighted / totalRuns : 0;
    const tmp: JobGroup = {
      workflow: "",
      job: leaf,
      repositories: [],
      samples: [],
      totalRuns,
      weightedBaselineSec: baseline,
      peakBaselineSec: peak,
      recommendedSku: "",
      recommendedTier: 2,
      reason: "",
      flags: [],
    };
    const rec = recommendTier(tmp, opts);
    leafRows.push({
      jobId: leaf,
      consumers: arr.length,
      totalRuns,
      weightedBaselineSec: baseline,
      peakBaselineSec: peak,
      recommendedTier: rec.tier,
      recommendedSku: chooseSkuLabel(rec.tier, opts.targetFamily),
      reason: rec.reason,
      repos: [...repos],
      families: [...families],
    });
  }
  leafRows.sort((a, b) => {
    if (b.recommendedTier !== a.recommendedTier) return b.recommendedTier - a.recommendedTier;
    return b.totalRuns - a.totalRuns;
  });
  writeFileSync(`${opts.output}-by-job.json`, JSON.stringify({ rows: leafRows }, null, 2));
  console.log(`Wrote ${opts.output}-by-job.json (${leafRows.length} job IDs)`);

  if (opts.writeMd) {
    writeFileSync(`${opts.output}.md`, renderMd(sorted, opts, leafRows));
    console.log(`Wrote ${opts.output}.md`);
  }
}

function round(n: number, d = 1): number {
  const p = Math.pow(10, d);
  return Math.round(n * p) / p;
}

interface LeafAggRow {
  jobId: string;
  consumers: number;
  totalRuns: number;
  weightedBaselineSec: number;
  peakBaselineSec: number;
  recommendedTier: number;
  recommendedSku: string;
  reason: string;
  repos: string[];
  families: string[];
}

function renderMd(groups: JobGroup[], opts: Options, leaves: LeafAggRow[] = []): string {
  const byTier = new Map<number, JobGroup[]>();
  for (const g of groups) {
    const arr = byTier.get(g.recommendedTier) ?? [];
    arr.push(g);
    byTier.set(g.recommendedTier, arr);
  }

  const lines: string[] = [];
  lines.push(`# Runner SKU sizing report`);
  lines.push("");
  lines.push(
    `Generated ${new Date().toISOString()}. ${groups.length} (workflow, job) groups across ${groups.reduce((a, g) => a + g.totalRuns, 0)} runs.`,
  );
  lines.push("");
  lines.push(`## Inputs`);
  lines.push("");
  lines.push(
    `- Speed factors vs gh-hosted (faster by): warp ${(opts.speedWarp * 100).toFixed(1)}%, buildjet ${(opts.speedBuildjet * 100).toFixed(1)}%, zupit-agents ${(opts.speedZupit * 100).toFixed(1)}%`,
  );
  lines.push(`- Assumed vCPU: zupit-agents=${opts.vcpuZupit}, gh-hosted-ubuntu=${opts.vcpuGhDefault}`);
  lines.push(
    `- Sizing rules: <= ${opts.shortThresholdSec}s gh-2vCPU baseline → 2x; otherwise bump tier (2/4/8/16) until wall <= ${opts.targetWallSec}s assuming linear scaling.`,
  );
  lines.push(
    `- Outlier filter: drop sample if normalised baseline > ${opts.outlierFactor}× group median (min ${opts.outlierMinSamples} samples) OR failure rate > ${opts.dropFailureAbove}%. Excluded samples are listed in \`${basename(opts.output)}-outliers.md\`.`,
  );
  lines.push("");
  lines.push(`## Summary`);
  lines.push("");
  lines.push(`| Recommended SKU | Job groups | Total runs |`);
  lines.push(`|---|---:|---:|`);
  for (const tier of [16, 8, 4, 2]) {
    const arr = byTier.get(tier) ?? [];
    if (!arr.length) continue;
    const runs = arr.reduce((a, g) => a + g.totalRuns, 0);
    lines.push(
      `| \`${opts.targetFamily === "warp" ? `warp-ubuntu-latest-x64-${tier}x` : chooseSkuLabel(tier, opts.targetFamily)}\` | ${arr.length} | ${runs} |`,
    );
  }
  lines.push("");

  for (const tier of [16, 8, 4, 2]) {
    const arr = byTier.get(tier);
    if (!arr || !arr.length) continue;
    lines.push(
      `## Recommended → \`${opts.targetFamily === "warp" ? `warp-ubuntu-latest-x64-${tier}x` : chooseSkuLabel(tier, opts.targetFamily)}\``,
    );
    lines.push("");
    lines.push(
      `| Workflow | Job | Repos | Runs | Typical baseline (gh-2vCPU s) | Peak baseline | Observed SKUs | Reason | Flags |`,
    );
    lines.push(`|---|---|---|---:|---:|---:|---|---|---|`);
    for (const g of arr) {
      const observed = g.samples
        .map((s) => `${s.sku} (${s.runs}r, ${round(s.avgWallSec)}s${s.excludedReason ? " — *excluded*" : ""})`)
        .join("<br>");
      lines.push(
        `| ${esc(g.workflow)} | ${esc(g.job)} | ${esc(g.repositories.join(", "))} | ${g.totalRuns} | ${round(g.weightedBaselineSec)} | ${round(g.peakBaselineSec)} | ${observed} | ${esc(g.reason)} | ${esc(g.flags.join(", "))} |`,
      );
    }
    lines.push("");
  }

  if (leaves.length > 0) {
    lines.push(`## Per-job-ID rollup (default for pipeline-templates)`);
    lines.push("");
    lines.push(
      `Each row aggregates every (workflow, repo) consumer that emitted a job with the same trailing ID. Use this to set the *default* RUN_ON / RUN_ON_BUILD / RUN_ON_ANALYZE for each step template.`,
    );
    lines.push("");
    lines.push(
      `| Job ID | Recommended | Consumers | Runs | Typical baseline (s) | Peak baseline (s) | Families observed | Reason |`,
    );
    lines.push(`|---|---|---:|---:|---:|---:|---|---|`);
    for (const l of leaves) {
      lines.push(
        `| \`${esc(l.jobId)}\` | \`${l.recommendedSku}\` | ${l.consumers} | ${l.totalRuns} | ${round(l.weightedBaselineSec)} | ${round(l.peakBaselineSec)} | ${esc(l.families.join(", "))} | ${esc(l.reason)} |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

interface OutlierRow {
  workflow: string;
  job: string;
  repository: string;
  family: Family;
  sku: string;
  vcpu: number;
  runs: number;
  avgWallSec: number;
  failureRate: number;
  normGh2vcpuSec: number;
  reason: string | undefined;
}

function renderOutliersMd(rows: OutlierRow[], opts: Options): string {
  const lines: string[] = [];
  lines.push(`# Runner-sizing outliers — needs review`);
  lines.push("");
  lines.push(`Generated ${new Date().toISOString()}. ${rows.length} samples excluded from the main aggregation.`);
  lines.push("");
  lines.push(`Filter:`);
  lines.push(`- \`--outlier-factor\` = ${opts.outlierFactor} (drop sample if normalised baseline > N × group median)`);
  lines.push(`- \`--drop-failure-above\` = ${opts.dropFailureAbove}% (drop sample if failure rate exceeds this)`);
  lines.push(
    `- \`--outlier-min-samples\` = ${opts.outlierMinSamples} (median-factor filter only engages above this group size)`,
  );
  lines.push("");
  lines.push(`Each row below was *not* counted toward the recommendation. Review them and decide:`);
  lines.push(
    `- **Genuine signal** (legitimately slow repo / big PR): consider raising the SKU for that specific consumer.`,
  );
  lines.push(`- **Genuine noise** (broken job, infra outage, cold cache one-off): leave excluded.`);
  lines.push("");
  lines.push(
    `| Workflow | Job | Repository | Family | SKU | Runs | Avg wall (s) | Failure % | Normalised baseline (gh-2vCPU s) | Excluded because |`,
  );
  lines.push(`|---|---|---|---|---|---:|---:|---:|---:|---|`);
  for (const r of rows) {
    lines.push(
      `| ${esc(r.workflow)} | ${esc(r.job)} | ${esc(r.repository)} | ${r.family} | ${esc(r.sku)} | ${r.runs} | ${r.avgWallSec} | ${r.failureRate.toFixed(1)} | ${r.normGh2vcpuSec} | ${esc(r.reason ?? "")} |`,
    );
  }
  return lines.join("\n");
}

function esc(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

main();
