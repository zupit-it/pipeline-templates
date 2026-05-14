#!/usr/bin/env node
/**
 * Analyze a Warpbuild usage-data JSON export and emit:
 *   - <output>.json — per-(workflow,job,sku) stats + upgrade/downgrade/keep action
 *   - <output>.md   — human-readable markdown grouped by action
 *
 * Usage:
 *   npx tsx tools/warpbuild-analysis/analyze.ts <input.json> [options]
 *
 * Options:
 *   --from <iso>       Only include instances with started_at >= ISO date (e.g. 2026-04-01)
 *   --to <iso>         Only include instances with started_at <= ISO date
 *   --output <path>    Output base path (default: <input-basename>-analysis)
 *                      The script writes <output>.json and <output>.md
 *   --no-md            Skip the markdown output
 *   --include-epoch    Keep instances with started_at == 1970-01-01T00:00:00Z (default: kept)
 *   --drop-epoch       Drop instances with started_at == 1970-01-01T00:00:00Z
 *
 * Classification rules (mirrors the existing y-analysis.json):
 *   upgrade   if high_cpu_frac >= 0.33 AND cpu_p95 >= 90       -> tier * 2 (cap 16)
 *   downgrade if all instances labelled "Low resource usage"
 *             AND no "High Disk IO" / "High Network IO" flag    -> tier / 2 (floor 2)
 *   keep      otherwise                                          -> same tier
 */

import { readFileSync, writeFileSync } from "fs";
import { basename, extname, resolve } from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Instance {
  started_at: string;
  ended_at: string;
  runner_instance_id: string;
  label?: string;
  job_link?: string;
  head_sha?: string;
  max_sustained_disk_io_bytes?: number;
  max_sustained_network_bytes?: number;
  max_sustained_cpu?: number;
  max_memory_utilization?: number;
  max_filesystem_utilization?: number;
  avg_filesystem_utilization?: number;
}

interface SkuBlock {
  display_name: string;
  instances: Instance[];
}

interface JobBlock {
  job_name: string;
  skus: SkuBlock[];
}

interface WorkflowBlock {
  workflow_name: string;
  workflow_url?: string;
  jobs: JobBlock[];
}

interface RepoBlock {
  repository: string;
  workflows: WorkflowBlock[];
}

interface InputJson {
  organization_id?: string;
  repositories: RepoBlock[];
}

interface Row {
  repository: string;
  workflow: string;
  job: string;
  sku: string;
  tier: number;
  instances: number;
  labels: Record<string, number>;
  cpuAvg: number;
  cpuP95: number;
  memAvg: number;
  memP95: number;
  fsP95: number;
  diskIoP95: number;
  netIoP95: number;
  action: "upgrade" | "downgrade" | "keep";
  target: number;
  reason: string;
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

interface Args {
  input: string;
  from?: number;
  to?: number;
  output: string;
  emitMd: boolean;
  dropEpoch: boolean;
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  let input: string | undefined;
  let from: number | undefined;
  let to: number | undefined;
  let output: string | undefined;
  let emitMd = true;
  let dropEpoch = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--from") {
      from = parseDate(args[++i], "--from");
    } else if (a === "--to") {
      to = parseDate(args[++i], "--to");
    } else if (a === "--output") {
      output = args[++i];
    } else if (a === "--no-md") {
      emitMd = false;
    } else if (a === "--drop-epoch") {
      dropEpoch = true;
    } else if (a === "--include-epoch") {
      dropEpoch = false;
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else if (a.startsWith("--")) {
      throw new Error(`Unknown option: ${a}`);
    } else if (!input) {
      input = a;
    } else {
      throw new Error(`Unexpected positional argument: ${a}`);
    }
  }

  if (!input) {
    printHelp();
    process.exit(1);
  }

  if (!output) {
    const base = basename(input, extname(input));
    output = `${base}-analysis`;
  }

  return { input: resolve(input!), from, to, output: resolve(output), emitMd, dropEpoch };
}

function parseDate(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`${flag} requires a date value`);
  const t = Date.parse(value);
  if (Number.isNaN(t)) throw new Error(`${flag}: invalid ISO date '${value}'`);
  return t;
}

function printHelp() {
  process.stderr.write(
    `Usage: npx tsx analyze.ts <input.json> [--from ISO] [--to ISO] [--output PATH] [--no-md] [--drop-epoch]\n`,
  );
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// Nearest-rank p95: sort ascending, take element at ceil(0.95 * N) - 1 (0-indexed).
function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(0.95 * sorted.length) - 1));
  return sorted[idx];
}

function parseTier(sku: string): number {
  const m = sku.match(/-(\d+)x$/);
  if (!m) return 0;
  return parseInt(m[1], 10);
}

function withTier(sku: string, tier: number): string {
  return sku.replace(/-\d+x$/, `-${tier}x`);
}

function nextTier(tier: number): number {
  // 2 -> 4 -> 8 -> 16 (cap)
  return Math.min(16, tier * 2);
}

function prevTier(tier: number): number {
  // 16 -> 8 -> 4 -> 2 (floor)
  return Math.max(2, Math.floor(tier / 2));
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

const EPOCH = "1970-01-01T00:00:00Z";

function buildRows(input: InputJson, fromMs?: number, toMs?: number, dropEpoch = false): Row[] {
  const rows: Row[] = [];

  for (const repo of input.repositories ?? []) {
    for (const wf of repo.workflows ?? []) {
      for (const job of wf.jobs ?? []) {
        for (const sku of job.skus ?? []) {
          const filtered = (sku.instances ?? []).filter((inst) => {
            if (dropEpoch && inst.started_at === EPOCH) return false;
            if (fromMs !== undefined || toMs !== undefined) {
              if (inst.started_at === EPOCH) return false;
              const t = Date.parse(inst.started_at);
              if (Number.isNaN(t)) return false;
              if (fromMs !== undefined && t < fromMs) return false;
              if (toMs !== undefined && t > toMs) return false;
            }
            return true;
          });

          if (filtered.length === 0) continue;

          const labels: Record<string, number> = {};
          const cpus: number[] = [];
          const mems: number[] = [];
          const fss: number[] = [];
          const disks: number[] = [];
          const nets: number[] = [];

          for (const inst of filtered) {
            const lbl = inst.label ?? "Unlabeled";
            labels[lbl] = (labels[lbl] ?? 0) + 1;
            cpus.push(inst.max_sustained_cpu ?? 0);
            mems.push(inst.max_memory_utilization ?? 0);
            fss.push(inst.max_filesystem_utilization ?? 0);
            disks.push(inst.max_sustained_disk_io_bytes ?? 0);
            nets.push(inst.max_sustained_network_bytes ?? 0);
          }

          const tier = parseTier(sku.display_name);
          const row: Row = {
            repository: repo.repository,
            workflow: wf.workflow_name,
            job: job.job_name,
            sku: sku.display_name,
            tier,
            instances: filtered.length,
            labels,
            cpuAvg: avg(cpus),
            cpuP95: p95(cpus),
            memAvg: avg(mems),
            memP95: p95(mems),
            fsP95: p95(fss),
            diskIoP95: p95(disks),
            netIoP95: p95(nets),
            action: "keep",
            target: tier,
            reason: "",
          };

          classify(row);
          rows.push(row);
        }
      }
    }
  }

  // Stable order matching existing analysis: workflow then job.
  rows.sort((a, b) => {
    if (a.workflow !== b.workflow) return a.workflow.localeCompare(b.workflow);
    return a.job.localeCompare(b.job);
  });

  return rows;
}

function classify(row: Row): void {
  const total = row.instances;
  const high = row.labels["High CPU Usage"] ?? 0;
  const low = row.labels["Low resource usage"] ?? 0;
  const ioFlag = (row.labels["High Disk IO"] ?? 0) + (row.labels["High Network IO"] ?? 0);
  const highFrac = total === 0 ? 0 : high / total;
  const lowFrac = total === 0 ? 0 : low / total;

  if (highFrac >= 0.33 && row.cpuP95 >= 90) {
    row.action = "upgrade";
    row.target = nextTier(row.tier);
    row.reason = `high_cpu_frac=${Math.round(highFrac * 100)}% cpu_p95=${row.cpuP95.toFixed(1)}`;
    return;
  }

  if (low === total && ioFlag === 0) {
    row.action = "downgrade";
    row.target = prevTier(row.tier);
    row.reason = `all ${total} low; cpu_p95=${row.cpuP95.toFixed(1)} mem_p95=${row.memP95.toFixed(1)}`;
    return;
  }

  row.action = "keep";
  row.target = row.tier;
  const tags = ioFlag > 0 ? " [IO-flag]" : "";
  row.reason = `cpu_p95=${row.cpuP95.toFixed(1)} mem_p95=${row.memP95.toFixed(1)} low=${Math.round(lowFrac * 100)}% highCpu=${Math.round(highFrac * 100)}%${tags}`;
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function renderMd(rows: Row[], source: string, range: { from?: number; to?: number }): string {
  const groups: Record<Row["action"], Row[]> = { upgrade: [], downgrade: [], keep: [] };
  for (const r of rows) groups[r.action].push(r);

  const lines: string[] = [];
  lines.push(`# Runner SKU analysis`);
  lines.push("");
  const rangeNote =
    range.from || range.to
      ? `  •  range: ${range.from ? new Date(range.from).toISOString() : "…"} → ${range.to ? new Date(range.to).toISOString() : "…"}`
      : "";
  lines.push(`Source: \`${source}\`  •  groups: ${rows.length}${rangeNote}`);
  lines.push("");

  const sections: { title: string; key: Row["action"]; targetCol: (r: Row) => string }[] = [
    { title: "UPGRADE", key: "upgrade", targetCol: (r) => withTier(r.sku, r.target) },
    { title: "DOWNGRADE", key: "downgrade", targetCol: (r) => withTier(r.sku, r.target) },
    { title: "KEEP", key: "keep", targetCol: () => "—" },
  ];

  for (const sec of sections) {
    const items = groups[sec.key];
    lines.push("");
    lines.push(`## ${sec.title} (${items.length})`);
    lines.push("");
    if (items.length === 0) {
      lines.push("_none_");
      continue;
    }
    lines.push(`| workflow | job | sku | → | n | cpu p95 | mem p95 | labels | reason |`);
    lines.push(`|---|---|---|---|---:|---:|---:|---|---|`);
    for (const r of items) {
      const labels = Object.entries(r.labels)
        .map(([k, v]) => `${k}:${v}`)
        .join(", ");
      lines.push(
        `| ${r.workflow} | ${r.job} | ${r.sku} | ${sec.targetCol(r)} | ${r.instances} | ${r.cpuP95.toFixed(1)} | ${r.memP95.toFixed(1)} | ${labels} | ${r.reason} |`,
      );
    }
  }

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv);

  const raw = readFileSync(args.input, "utf-8");
  const input: InputJson = JSON.parse(raw);

  const rows = buildRows(input, args.from, args.to, args.dropEpoch);

  const jsonOut = `${args.output}.json`;
  writeFileSync(jsonOut, JSON.stringify({ rows }, null, 2));
  process.stdout.write(`Wrote ${jsonOut} (${rows.length} groups)\n`);

  if (args.emitMd) {
    const mdOut = `${args.output}.md`;
    const md = renderMd(rows, args.input, { from: args.from, to: args.to });
    writeFileSync(mdOut, md);
    process.stdout.write(`Wrote ${mdOut}\n`);
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`Error: ${(err as Error).message}\n`);
  process.exit(1);
}
