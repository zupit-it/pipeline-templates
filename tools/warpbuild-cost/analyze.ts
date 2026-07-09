#!/usr/bin/env node
/**
 * Analyze the two CSVs WarpBuild lets you download from the dashboard:
 *   - jobs report  (repo, workflow, job, run_count, duration/queue/cpu/memory percentiles)
 *   - ci billing   (one row per billed job run: runner_label, execution/billed time, cost)
 *
 * and emit per-(repo, job, runner_label) downgrade recommendations with
 * estimated $ savings, including the cheaper arm64 SKUs.
 *
 * Usage:
 *   npx tsx tools/warpbuild-cost/analyze.ts <jobs-report.csv> <ci-billing.csv> [options]
 *
 * The two positional CSVs are sniffed by header, so order does not matter.
 *
 * Options:
 *   --repo <substr>    Only include repos whose name contains <substr>. Repeatable.
 *   --cpu-max <n>      Max projected cpu%% on the target SKU to call it "safe" (default 75).
 *   --mem-max <n>      Max projected mem%% on the target SKU to be feasible (default 80).
 *   --min-savings <n>  Hide recommendations saving less than n $ over the CSV window (default 0.01).
 *   --output <path>    Output base path (default: warpbuild-cost-analysis). Writes <path>.json and <path>.md
 *   --no-md            Skip the markdown output.
 *
 * Model:
 *   - cpu_p90 / memory_p90 in the jobs report are %% of the CURRENT runner.
 *     Projected usage on a candidate SKU scales by core / RAM ratio.
 *   - mem is a hard gate: projected mem%% > --mem-max -> candidate rejected.
 *   - cpu is a soft gate: projected cpu%% <= --cpu-max -> "safe" (no slowdown expected);
 *     above that the job is (partly) CPU-bound, so we inflate the expected duration
 *     Amdahl-style: newDur = dur * (1 + cpu/100 * (coreRatio - 1)) and re-bill with
 *     per-minute rounding (60s minimum). If it is still cheaper it is reported as a
 *     "tradeoff" (cheaper but slower).
 *   - arm64 SKUs are 25%% cheaper at equal size; per-core performance is assumed
 *     comparable, but arch compatibility (docker images, native deps) must be
 *     verified by hand before switching.
 *   - Skipped-step mix: many templated jobs gate their real work behind a
 *     workdir-has-changes check, so the same job name mixes ~10s skipped runs
 *     with real heavy runs. We split runs at --skip-cutoff (default 30s):
 *     skipped runs are billed at the 60s minimum with no CPU inflation, active
 *     runs get the Amdahl treatment. If active runs are < 15%% of the group the
 *     jobs-report cpu_p90 likely reflects the skipped runs, so the group is
 *     never marked "safe" and gets a bimodal warning instead.
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// Runner catalog (https://www.warpbuild.com/docs/ci/cloud-runners)
// ---------------------------------------------------------------------------

type Arch = "x64" | "arm64";

const TIERS = [2, 4, 8, 16] as const;
type Tier = (typeof TIERS)[number];

const SPECS: Record<Tier, { cores: number; ramGb: number }> = {
  2: { cores: 2, ramGb: 7 },
  4: { cores: 4, ramGb: 16 },
  8: { cores: 8, ramGb: 32 },
  16: { cores: 16, ramGb: 64 },
};

const PRICE_PER_MIN: Record<Arch, Record<Tier, number>> = {
  x64: { 2: 0.004, 4: 0.008, 8: 0.016, 16: 0.032 },
  arm64: { 2: 0.003, 4: 0.006, 8: 0.012, 16: 0.024 },
};

function labelFor(arch: Arch, tier: Tier): string {
  return `warp-ubuntu-latest-${arch}-${tier}x`;
}

function parseRunnerLabel(label: string): { arch: Arch; tier: Tier } | null {
  const m = label.match(/warp-ubuntu-[^-]+-(x64|arm64)-(\d+)x/);
  if (!m) return null;
  const tier = parseInt(m[2], 10) as Tier;
  if (!TIERS.includes(tier)) return null;
  return { arch: m[1] as Arch, tier };
}

// ---------------------------------------------------------------------------
// CSV parsing (handles quoted fields with embedded commas)
// ---------------------------------------------------------------------------

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

function toRecords(rows: string[][]): Record<string, string>[] {
  const header = rows[0];
  return rows.slice(1).map((r) => {
    const rec: Record<string, string> = {};
    header.forEach((h, i) => (rec[h.trim()] = r[i] ?? ""));
    return rec;
  });
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

interface Args {
  files: string[];
  repos: string[];
  cpuMax: number;
  memMax: number;
  minSavings: number;
  skipCutoffS: number;
  output: string;
  emitMd: boolean;
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  const files: string[] = [];
  const repos: string[] = [];
  let cpuMax = 75;
  let memMax = 80;
  let minSavings = 0.01;
  let skipCutoffS = 30;
  let output = "warpbuild-cost-analysis";
  let emitMd = true;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--repo") repos.push(args[++i]);
    else if (a === "--cpu-max") cpuMax = parseFloat(args[++i]);
    else if (a === "--mem-max") memMax = parseFloat(args[++i]);
    else if (a === "--min-savings") minSavings = parseFloat(args[++i]);
    else if (a === "--skip-cutoff") skipCutoffS = parseFloat(args[++i]);
    else if (a === "--output") output = args[++i];
    else if (a === "--no-md") emitMd = false;
    else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else if (a.startsWith("--")) throw new Error(`Unknown option: ${a}`);
    else files.push(a);
  }

  if (files.length !== 2) {
    printHelp();
    process.exit(1);
  }

  return {
    files: files.map((f) => resolve(f)),
    repos,
    cpuMax,
    memMax,
    minSavings,
    skipCutoffS,
    output: resolve(output),
    emitMd,
  };
}

function printHelp() {
  process.stderr.write(
    `Usage: npx tsx analyze.ts <jobs-report.csv> <ci-billing.csv> [--repo SUBSTR]... [--cpu-max N] [--mem-max N] [--min-savings $] [--skip-cutoff S] [--output PATH] [--no-md]\n`,
  );
}

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

interface JobMetrics {
  cpuP90: number;
  memP90: number;
  durationP90: number;
  runCount: number;
}

interface Candidate {
  label: string;
  arch: Arch;
  tier: Tier;
  safe: boolean; // projected cpu <= cpuMax -> no slowdown expected
  projCpu: number | null;
  projMem: number | null;
  estDurationS: number; // per-run, after Amdahl inflation
  estCost: number; // over the CSV window
  savings: number;
  savingsPct: number;
}

interface Group {
  repo: string;
  job: string;
  runner: string;
  arch: Arch | null;
  tier: Tier | null;
  runs: number;
  activeRuns: number; // runs with execution_time >= skip-cutoff (steps actually ran)
  skippedRuns: number; // short runs: gated steps skipped, no real CPU load
  avgExecS: number;
  activeAvgExecS: number; // avg over active runs only
  billedMin: number;
  cost: number;
  cpuP90: number | null;
  memP90: number | null;
  bimodal: boolean; // skip/active mix where cpu_p90 may not represent heavy runs
  action: "downgrade" | "switch-arm64" | "keep" | "no-metrics" | "unknown-runner";
  best: Candidate | null;
  bestSameArch: Candidate | null; // best pure-downgrade without arch switch
  notes: string[];
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

function sniff(records: Record<string, string>[], path: string): "jobs" | "billing" {
  if (records.length === 0) throw new Error(`${path}: empty CSV`);
  const keys = Object.keys(records[0]);
  if (keys.includes("runner_label") && keys.includes("billed_time")) return "billing";
  if (keys.includes("cpu_p90") && keys.includes("run_count")) return "jobs";
  throw new Error(`${path}: not a WarpBuild jobs-report or ci-billing CSV (columns: ${keys.join(", ")})`);
}

function buildMetrics(records: Record<string, string>[]): Map<string, JobMetrics> {
  // Join key: repo || job_name. The billing CSV has no workflow column, so when a
  // job name appears under several workflows keep the worst-case cpu/mem.
  const map = new Map<string, JobMetrics>();
  for (const r of records) {
    const key = `${r.repo} ${r.job_name}`;
    const m: JobMetrics = {
      cpuP90: parseFloat(r.cpu_p90) || 0,
      memP90: parseFloat(r.memory_p90) || 0,
      durationP90: parseFloat(r.duration_p90) || 0,
      runCount: parseInt(r.run_count, 10) || 0,
    };
    const prev = map.get(key);
    if (!prev) map.set(key, m);
    else
      map.set(key, {
        cpuP90: Math.max(prev.cpuP90, m.cpuP90),
        memP90: Math.max(prev.memP90, m.memP90),
        durationP90: Math.max(prev.durationP90, m.durationP90),
        runCount: prev.runCount + m.runCount,
      });
  }
  return map;
}

function buildGroups(
  billing: Record<string, string>[],
  metrics: Map<string, JobMetrics>,
  args: Args,
): Group[] {
  interface Acc {
    repo: string;
    job: string;
    runner: string;
    execTimes: number[]; // per-run execution seconds — needed to re-bill candidates run by run
    billedS: number;
    cost: number;
  }
  const accs = new Map<string, Acc>();

  for (const r of billing) {
    if (args.repos.length > 0 && !args.repos.some((s) => r.repo.includes(s))) continue;
    const key = `${r.repo} ${r.job_name} ${r.runner_label}`;
    let acc = accs.get(key);
    if (!acc) {
      acc = { repo: r.repo, job: r.job_name, runner: r.runner_label, execTimes: [], billedS: 0, cost: 0 };
      accs.set(key, acc);
    }
    acc.execTimes.push(parseFloat(r.execution_time) || 0);
    acc.billedS += parseFloat(r.billed_time) || 0;
    acc.cost += parseFloat(r.total_cost) || 0;
  }

  const groups: Group[] = [];
  for (const acc of accs.values()) {
    const parsed = parseRunnerLabel(acc.runner);
    const m = metrics.get(`${acc.repo} ${acc.job}`);
    const runs = acc.execTimes.length;
    const active = acc.execTimes.filter((t) => t >= args.skipCutoffS);
    const g: Group = {
      repo: acc.repo,
      job: acc.job,
      runner: acc.runner,
      arch: parsed?.arch ?? null,
      tier: parsed?.tier ?? null,
      runs,
      activeRuns: active.length,
      skippedRuns: runs - active.length,
      avgExecS: acc.execTimes.reduce((s, t) => s + t, 0) / runs,
      activeAvgExecS: active.length > 0 ? active.reduce((s, t) => s + t, 0) / active.length : 0,
      billedMin: acc.billedS / 60,
      cost: acc.cost,
      cpuP90: m ? m.cpuP90 : null,
      memP90: m ? m.memP90 : null,
      // Heavy runs rarer than ~15% of the group -> the jobs-report percentiles are
      // computed over mostly-skipped runs and can miss the heavy profile entirely.
      bimodal: active.length > 0 && runs - active.length > 0 && active.length / runs < 0.15,
      action: "keep",
      best: null,
      bestSameArch: null,
      notes: [],
    };
    recommend(g, acc.execTimes, args);
    groups.push(g);
  }

  groups.sort((a, b) => {
    if (a.repo !== b.repo) return a.repo.localeCompare(b.repo);
    const sa = a.best?.savings ?? 0;
    const sb = b.best?.savings ?? 0;
    if (sa !== sb) return sb - sa;
    return b.cost - a.cost;
  });
  return groups;
}

function recommend(g: Group, execTimes: number[], args: Args): void {
  if (!g.arch || !g.tier) {
    g.action = "unknown-runner";
    g.notes.push(`unrecognized runner label`);
    return;
  }

  const cur = SPECS[g.tier];
  const hasMetrics = g.cpuP90 !== null;
  const cpu = g.cpuP90 ?? 0;
  const mem = g.memP90 ?? 0;

  const candidates: Candidate[] = [];
  for (const arch of ["x64", "arm64"] as Arch[]) {
    for (const tier of TIERS) {
      if (tier > g.tier) continue;
      if (arch === g.arch && tier === g.tier) continue;
      // Blind real downgrades only when every run fits the 60s billing minimum anyway.
      if (!hasMetrics && tier < g.tier && g.activeRuns > 0) continue;

      const cand = SPECS[tier];
      const projMem = hasMetrics ? (mem * cur.ramGb) / cand.ramGb : null;
      if (projMem !== null && projMem > args.memMax) continue;

      const projCpu = hasMetrics ? (cpu * cur.cores) / cand.cores : null;
      const coreRatio = cur.cores / cand.cores;
      const inflation = 1 + (cpu / 100) * (coreRatio - 1);
      // Re-bill run by run: skipped runs pay the 60s minimum with no inflation,
      // active runs get the Amdahl slowdown before per-minute rounding.
      let estCost = 0;
      for (const t of execTimes) {
        const dur = t >= args.skipCutoffS ? t * inflation : t;
        estCost += Math.max(1, Math.ceil(dur / 60)) * PRICE_PER_MIN[arch][tier];
      }
      const estDurationS = g.activeAvgExecS * inflation;
      const savings = g.cost - estCost;
      if (savings < args.minSavings) continue;

      candidates.push({
        label: labelFor(arch, tier),
        arch,
        tier,
        // Bimodal groups never count as safe: the percentiles likely describe the
        // skipped runs, not the heavy ones the downgrade must survive.
        safe:
          tier === g.tier ||
          (projCpu !== null && projCpu <= args.cpuMax && !g.bimodal) ||
          (!hasMetrics && g.activeRuns === 0),
        projCpu,
        projMem,
        estDurationS,
        estCost,
        savings,
        savingsPct: g.cost > 0 ? (savings / g.cost) * 100 : 0,
      });
    }
  }

  if (candidates.length === 0) {
    g.action = hasMetrics ? "keep" : "no-metrics";
    return;
  }

  // Best = max savings; among equal savings prefer safe, then bigger tier (less risk).
  candidates.sort((a, b) => {
    if (b.savings !== a.savings) return b.savings - a.savings;
    if (a.safe !== b.safe) return a.safe ? -1 : 1;
    return b.tier - a.tier;
  });
  g.best = candidates[0];
  g.bestSameArch = candidates.find((c) => c.arch === g.arch) ?? null;
  g.action = g.best.arch !== g.arch && g.best.tier === g.tier ? "switch-arm64" : "downgrade";
  if (!hasMetrics) g.notes.push("no cpu/mem metrics in jobs report");
  if (g.bimodal)
    g.notes.push(
      "skip/heavy mix (" + g.activeRuns + "/" + g.runs + " active): cpu/mem p90 may reflect skipped runs — verify heavy-run load before downgrading",
    );
  else if (!g.best.safe && g.best.tier !== g.tier) g.notes.push("CPU-bound: expect slower runs on target");
  if (g.best.arch !== g.arch) g.notes.push("arch switch: verify arm64 compatibility");
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const $ = (n: number) => `$${n.toFixed(3)}`;
const pct = (n: number | null) => (n === null ? "—" : `${n.toFixed(0)}%`);

function renderMd(groups: Group[], args: Args): string {
  const lines: string[] = [];
  lines.push(`# WarpBuild cost analysis`);
  lines.push("");
  lines.push(
    `Sources: \`${args.files.map((f) => f.split(/[\\/]/).pop()).join("`, `")}\`  •  thresholds: cpu ≤ ${args.cpuMax}%, mem ≤ ${args.memMax}%`,
  );
  lines.push("");
  lines.push(
    `Savings are over the billing CSV window. "safe" = projected cpu fits, same speed expected; "tradeoff" = cheaper but CPU-bound, runs will slow down (est. duration shown).`,
  );

  const repos = [...new Set(groups.map((g) => g.repo))];
  let grandCost = 0;
  let grandSavings = 0;

  for (const repo of repos) {
    const rows = groups.filter((g) => g.repo === repo);
    const cost = rows.reduce((s, g) => s + g.cost, 0);
    const savings = rows.reduce((s, g) => s + (g.best?.savings ?? 0), 0);
    grandCost += cost;
    grandSavings += savings;

    lines.push("");
    lines.push(`## ${repo}`);
    lines.push("");
    lines.push(
      `Window cost: **${$(cost)}**  •  potential: **${$(cost - savings)}** (save ${$(savings)}, ${cost > 0 ? ((savings / cost) * 100).toFixed(0) : 0}%)`,
    );
    lines.push("");

    const recs = rows.filter((g) => g.best);
    const keeps = rows.filter((g) => !g.best);

    if (recs.length > 0) {
      lines.push(`### Recommendations`);
      lines.push("");
      lines.push(`| job | runner | runs (active) | cost | cpu p90 | mem p90 | → target | est cost | save | mode | notes |`);
      lines.push(`|---|---|---:|---:|---:|---:|---|---:|---:|---|---|`);
      for (const g of recs) {
        const b = g.best!;
        const mode = b.safe ? "safe" : `tradeoff (~${Math.round(b.estDurationS)}s/run)`;
        lines.push(
          `| ${g.job} | ${g.runner} | ${g.runs} (${g.activeRuns}) | ${$(g.cost)} | ${pct(g.cpuP90)} | ${pct(g.memP90)} | ${b.label} | ${$(b.estCost)} | ${$(b.savings)} (${b.savingsPct.toFixed(0)}%) | ${mode} | ${g.notes.join("; ")} |`,
        );
      }
      lines.push("");
    }

    if (keeps.length > 0) {
      lines.push(`### Keep as-is`);
      lines.push("");
      lines.push(`| job | runner | runs | cost | cpu p90 | mem p90 | why |`);
      lines.push(`|---|---|---:|---:|---:|---:|---|`);
      for (const g of keeps) {
        const why =
          g.action === "unknown-runner"
            ? "unrecognized runner label"
            : g.action === "no-metrics"
              ? "no metrics; already at floor or too long to judge blind"
              : "no cheaper SKU fits cpu/mem";
        lines.push(
          `| ${g.job} | ${g.runner} | ${g.runs} | ${$(g.cost)} | ${pct(g.cpuP90)} | ${pct(g.memP90)} | ${why} |`,
        );
      }
    }
  }

  lines.push("");
  lines.push(`## Total`);
  lines.push("");
  lines.push(
    `Current: **${$(grandCost)}**  →  potential: **${$(grandCost - grandSavings)}**  (save **${$(grandSavings)}**, ${grandCost > 0 ? ((grandSavings / grandCost) * 100).toFixed(0) : 0}% of the window)`,
  );
  lines.push("");
  lines.push(`### arm64 checklist (before switching any job)`);
  lines.push("");
  lines.push(
    `- docker build/push jobs: an arm64 runner natively builds \`linux/arm64\` images. Building \`linux/amd64\` there falls back to QEMU emulation (5-10x slower) — keep docker jobs on x64 unless you ship arm images or build multi-arch anyway.`,
  );
  lines.push(`- node: native modules (\`node-gyp\`, \`esbuild\`, \`sharp\`, …) need arm64 prebuilds — most popular ones have them.`);
  lines.push(`- .NET: fine on arm64 since .NET 6; check any RID-specific publish (\`-r linux-x64\`).`);
  lines.push(`- sonar scanners, az cli, gh cli: all ship arm64 builds.`);
  lines.push(`- anything downloading x64-only binaries in a script will break at runtime, not at label change.`);

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv);

  const parsed = args.files.map((f) => ({ path: f, records: toRecords(parseCsv(readFileSync(f, "utf-8"))) }));
  const kinds = parsed.map((p) => sniff(p.records, p.path));
  if (kinds[0] === kinds[1]) throw new Error(`need one jobs-report CSV and one ci-billing CSV, got two ${kinds[0]} files`);

  const jobs = parsed[kinds[0] === "jobs" ? 0 : 1].records;
  const billing = parsed[kinds[0] === "billing" ? 0 : 1].records;

  const metrics = buildMetrics(jobs);
  const groups = buildGroups(billing, metrics, args);

  const jsonOut = `${args.output}.json`;
  writeFileSync(jsonOut, JSON.stringify({ groups }, null, 2));
  process.stdout.write(`Wrote ${jsonOut} (${groups.length} groups)\n`);

  if (args.emitMd) {
    const mdOut = `${args.output}.md`;
    writeFileSync(mdOut, renderMd(groups, args));
    process.stdout.write(`Wrote ${mdOut}\n`);
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`Error: ${(err as Error).message}\n`);
  process.exit(1);
}
