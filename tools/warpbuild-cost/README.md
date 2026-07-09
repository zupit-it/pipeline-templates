# warpbuild-cost

CLI that joins the two CSVs downloadable from the WarpBuild dashboard — the **jobs report** (per-job cpu/mem/duration percentiles) and the **CI billing export** (one row per billed run) — into a per-`(repo, job, runner_label)` cost report with downgrade / arm64-switch recommendations and estimated $ savings.

Sibling tools: `tools/warpbuild-analysis` (WarpBuild usage-data JSON export), `tools/runner-sizing` (GitHub Actions usage CSV). Use this one when all you have is the two dashboard CSVs.

Outputs:

- `<output>.json` — machine-readable groups with full stats, best candidate, notes.
- `<output>.md` — markdown report per repo: recommendations sorted by savings, keep-as-is table, repo and grand totals, arm64 checklist.

## Run

```bash
npx tsx tools/warpbuild-cost/analyze.ts jobs-report.csv ci-billing.csv [options]
```

The two positional CSVs are sniffed by header, so order does not matter. No dependencies.

### Options

| Flag                | Default                   | Effect                                                                                    |
| ------------------- | ------------------------- | ----------------------------------------------------------------------------------------- |
| `--repo <substr>`   | all                       | Only repos whose name contains the substring. Repeatable.                                 |
| `--cpu-max <n>`     | 75                        | Max projected cpu% on the target SKU to call a candidate "safe" (no slowdown expected).   |
| `--mem-max <n>`     | 80                        | Max projected mem% on the target SKU; above this the candidate is rejected outright.      |
| `--min-savings <n>` | 0.01                      | Hide recommendations saving less than n dollars over the CSV window.                      |
| `--skip-cutoff <s>` | 30                        | Runs shorter than this many seconds count as "skipped" (gated steps did not run).         |
| `--output <path>`   | `warpbuild-cost-analysis` | Output base path; writes `<path>.json` and `<path>.md`.                                   |
| `--no-md`           |                           | JSON only.                                                                                 |

## Model

Prices and specs from <https://www.warpbuild.com/docs/ci/cloud-runners>: x64 = $0.002/vCPU-min, arm64 = $0.0015/vCPU-min (25% cheaper), 60s billing minimum, per-minute rounding.

Per `(repo, job, runner_label)` group:

- `cpu_p90` / `memory_p90` from the jobs report are % of the **current** runner; projected usage on a candidate SKU scales by core / RAM ratio.
- **mem** is a hard gate; **cpu** is soft: within `--cpu-max` the candidate is "safe", above it the run is CPU-bound and the expected duration is inflated Amdahl-style (`dur × (1 + cpu/100 × (coreRatio − 1))`) before re-billing — if still cheaper it is reported as a **tradeoff** (cheaper but slower, estimated per-run duration shown).
- **Skipped-step mix**: templated jobs gate real work behind `workdir-has-changes`, so one job name mixes ~10s skipped runs with heavy runs. Runs are split at `--skip-cutoff`: skipped runs are re-billed at the 60s minimum with no inflation; only active runs pay the CPU penalty. If active runs are under 15% of the group, the report percentiles likely describe the skipped runs — the group is never marked "safe" and gets a bimodal warning.
- Jobs missing from the jobs report (it only covers the repos/top jobs you exported) only get the lateral same-size arm64 suggestion; real downgrades need metrics.

## Reading the report

- **safe** — same speed expected, just cheaper. Apply freely (after the arm64 checklist if it is an arch switch).
- **tradeoff** — cheaper but CPU-bound; the estimated new per-run duration is in the `mode` column. Decide per job whether the slowdown is acceptable (deploy jobs usually yes, PR-blocking jobs maybe not).
- Savings are **over the billing CSV window**, not per month — scale by your window length.
- arm64 rows require the checklist at the bottom of the report; docker build jobs building `linux/amd64` images should stay on x64 (QEMU emulation is 5-10x slower).

## Workflow

1. Download both CSVs from the WarpBuild dashboard (make sure the jobs report includes every repo you care about).
2. `npx tsx tools/warpbuild-cost/analyze.ts jobs-report-<date>.csv ci-billing-<date>.csv --output reports/<date>`
3. Apply "safe" rows by editing the `runs-on` / `RUN_ON*` labels in the affected workflows.
4. For "tradeoff" rows, trial the smaller SKU on one job and watch the next few runs' duration before rolling out.
