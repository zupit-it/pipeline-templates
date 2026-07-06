# runner-sizing

CLI that turns a **GitHub Actions usage-data CSV export** into a per-`(workflow, job)` runner SKU recommendation, normalised across heterogeneous runner pools (warpbuild, buildjet, zupit-agents, github-hosted).

Outputs three machine + human files per run:

| File                     | Purpose                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `<output>.json`          | One row per `(workflow, job)` with samples, baselines, recommendation, flags.                        |
| `<output>-by-job.json`   | Rollup by trailing job-ID — directly maps to a pipeline-templates _step_ (use this to set defaults). |
| `<output>-outliers.json` | Samples excluded from the aggregation (high failure rate or > N× the group median). Review by hand.  |
| `<output>.md`            | Markdown report grouped by recommended SKU + per-job-ID rollup.                                      |
| `<output>-outliers.md`   | Markdown view of the outliers file.                                                                  |

## When to run

- After exporting fresh `Usage data > Export` from GitHub Actions admin (CSV).
- When tuning `RUN_ON` / `RUN_ON_BUILD` / `RUN_ON_LINT` / `RUN_ON_ANALYZE` defaults in this repo's workflow templates.
- When evaluating whether a job that runs on the org's self-hosted pool would still fit on a smaller warpbuild SKU.

## Run

```bash
npx tsx tools/runner-sizing/analyze.ts <input.csv> [options]
```

Works with `bun`, `npx tsx`, `ts-node`, or any Node-compatible runtime. No dependencies.

### Options

| Flag                         | Effect                                                                                                                                                                                                                                | Default                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `--output <path>`            | Output base path; writes `<path>.json`, `<path>.md`, `<path>-by-job.json`, `<path>-outliers.json`, `<path>-outliers.md`.                                                                                                              | `<input-basename>-sizing` |
| `--no-md`                    | Skip markdown outputs (JSON only).                                                                                                                                                                                                    | off                       |
| `--vcpu-zupit <n>`           | vCPU count assumed for `zupit-agents` self-hosted runners.                                                                                                                                                                            | `4`                       |
| `--vcpu-gh-default <n>`      | vCPU count for github-hosted `ubuntu-*` runners.                                                                                                                                                                                      | `2`                       |
| `--target-wall-sec <n>`      | Target wall time (seconds) for the recommended SKU. Tier is raised until the projected wall stays under this.                                                                                                                         | `240`                     |
| `--short-threshold <n>`      | Jobs whose gh-2vCPU baseline is below this short-circuit to the cheapest SKU (`2x`).                                                                                                                                                  | `60`                      |
| `--min-runs <n>`             | Drop `(workflow, job, sku)` groups below this many runs before aggregation.                                                                                                                                                           | `1`                       |
| `--speed-warp <n>`           | Warpbuild speedup vs github-hosted, expressed as the fraction _faster_ (so `0.42` ↔ "42% faster").                                                                                                                                   | `0.42`                    |
| `--speed-buildjet <n>`       | BuildJet speedup vs github-hosted.                                                                                                                                                                                                    | `0.318`                   |
| `--speed-zupit <n>`          | zupit-agents speedup vs github-hosted.                                                                                                                                                                                                | `0.2684`                  |
| `--target-family <fam>`      | Runner family the recommendation should target. One of `warp`, `buildjet`, `zupit-agents`, `gh-hosted`. Drives the recommended SKU label _and_ the wall-time math (a faster family needs less vCPU to hit the same target wall time). | `warp`                    |
| `--outlier-factor <n>`       | Drop a sample if its normalised baseline is greater than this multiple of the group's median. `0` disables.                                                                                                                           | `3.0`                     |
| `--drop-failure-above <pct>` | Drop a sample if its `Failure rate` column exceeds this percent. `100` disables.                                                                                                                                                      | `80`                      |
| `--outlier-min-samples <n>`  | Median-factor outlier filter only engages above this number of samples per group.                                                                                                                                                     | `4`                       |
| `-h`, `--help`               | Print usage and exit.                                                                                                                                                                                                                 | —                         |

### Examples

Plain run on a full CSV export:

```bash
npx tsx tools/runner-sizing/analyze.ts usage-2026-05.csv
# Wrote usage-2026-05-sizing.json (660 groups)
# Wrote usage-2026-05-sizing-outliers.json (64 samples)
# Wrote usage-2026-05-sizing-by-job.json (91 job IDs)
# Wrote usage-2026-05-sizing.md
# Wrote usage-2026-05-sizing-outliers.md
```

Custom output path and a tighter target (3-minute wall instead of 4):

```bash
npx tsx tools/runner-sizing/analyze.ts usage-2026-05.csv \
  --output reports/may-2026-sizing \
  --target-wall-sec 180
```

Disable outlier filtering (use raw data):

```bash
npx tsx tools/runner-sizing/analyze.ts usage.csv --outlier-factor 0 --drop-failure-above 100
```

Recommend a `buildjet` SKU instead of warp:

```bash
npx tsx tools/runner-sizing/analyze.ts usage.csv --target-family buildjet
```

## How it works

1. **Parse the CSV.** The GitHub export wraps cells in extra quotes and prefixes string fields with `'` (Excel cast hack); the parser strips both. Embedded commas in the `Runner labels` column are honoured.
2. **Classify each row by runner family** from the labels:
    - `warp-ubuntu-latest-x64-Nx` → `warp` with `N` vCPU.
    - `buildjet-Nvcpu-…` → `buildjet` with `N` vCPU.
    - `zupit-agents` → `zupit-agents` with `--vcpu-zupit` (default `4`).
    - `ubuntu-*` → `gh-hosted` with `--vcpu-gh-default` (default `2`).
    - `macos-*` / `windows-*` / unrecognised → skipped (out of scope).
3. **Normalise wall time** to **gh-equivalent seconds on a 2-vCPU runner**:

    ```
    baseline = wall × speed_factor(family) × (vcpu / 2)
    ```

    This bakes in the two axes that vary across the export — single-thread speed (family) and parallelism (vCPU count) — and yields a number that is comparable across all observed runs.

4. **Aggregate per `(workflow, job)`.** Weighted average (by `Job runs`) over all samples produces a _typical baseline_; the maximum over samples is reported as _peak baseline_ and used only for flagging burstiness.
5. **Outlier filter.** Two filters run BEFORE aggregation; flagged samples are kept in the per-group view (marked `*excluded*`) and re-exported to the `-outliers.{json,md}` files for review:
    - **Failure-rate filter** — `Failure rate > --drop-failure-above` (default 80%). A 100%-failing job's wall time reflects abort behaviour, not workload size.
    - **Median-factor filter** — `baseline > --outlier-factor × group_median` (default `3.0`). Catches single-repo bursts (cold cache, mega-PR, infra hiccup) without erasing the typical signal. Engages only when the group has at least `--outlier-min-samples` samples (default `4`).
6. **Recommend a tier** in `{2, 4, 8, 16}` — the smallest tier such that:

    ```
    wall_on_target_family_Nvcpu ≤ --target-wall-sec
    wall_on_target_family_Nvcpu = baseline × (2 / N) / speed_factor(--target-family)
    ```

    Linear scaling is assumed (CPU-bound jobs scale roughly linearly with vCPU; IO-bound jobs scale sub-linearly, in which case this script is _conservative_ and may suggest a tier that won't actually help).

7. **Roll up by trailing job-ID** for the pipeline-templates view. Job names in the CSV look like `common / java-common / springboot-tests-mysql / springboot-run-tests` — the trailing `springboot-run-tests` matches the job ID in `springboot-step-tests-mysql.yml`. Aggregate every consumer of that step → one recommendation per step template.

## Output shape

### `<output>.json`

```json
{
    "options": {
        /* full CLI option set, including resolved defaults */
    },
    "generatedAt": "2026-05-14T10:09:16.079Z",
    "inputRows": 1941,
    "groupCount": 660,
    "groups": [
        {
            "workflow": "pull-request.yml",
            "job": "common / java-common / springboot-tests-mysql / springboot-run-tests",
            "repositories": ["acme-backend", "…"],
            "totalRuns": 378,
            "weightedBaselineSec": 941.9,
            "peakBaselineSec": 2600.2,
            "recommendedSku": "warp-ubuntu-latest-x64-8x",
            "recommendedTier": 8,
            "reason": "typical 941.9s on 2-vCPU gh → on warp-8x ~136.6s (target ≤ 240s)",
            "flags": ["bursty peak/typical=2.8x (peak 2600s)", "outliers_dropped=12/378 runs"],
            "samples": [
                {
                    "family": "zupit-agents",
                    "sku": "zupit-agents",
                    "vcpu": 4,
                    "runs": 94,
                    "avgWallSec": 352.2,
                    "failureRate": 0,
                    "normGh2vcpuSec": 962.9,
                    "excludedReason": null
                }
            ]
        }
    ]
}
```

### `<output>-by-job.json`

```json
{
    "rows": [
        {
            "jobId": "sonar-analyze",
            "consumers": 35,
            "totalRuns": 2064,
            "weightedBaselineSec": 588.7,
            "peakBaselineSec": 3611.2,
            "recommendedTier": 4,
            "recommendedSku": "warp-ubuntu-latest-x64-4x",
            "reason": "typical 588.7s on 2-vCPU gh → on warp-4x ~170.7s (target ≤ 240s)",
            "repos": ["acme-frontend", "…"],
            "families": ["zupit-agents", "warp"]
        }
    ]
}
```

### `<output>-outliers.json`

```json
{
    "count": 64,
    "filter": {
        "outlierFactor": 3,
        "dropFailureAbove": 80,
        "outlierMinSamples": 4
    },
    "rows": [
        {
            "workflow": "pull-request.yml",
            "job": "…",
            "repository": "acme-backend",
            "family": "zupit-agents",
            "sku": "zupit-agents",
            "vcpu": 4,
            "runs": 12,
            "avgWallSec": 951.1,
            "failureRate": 8.3,
            "normGh2vcpuSec": 2600.2,
            "reason": "baseline 2600s > 3× median 676s"
        }
    ]
}
```

## Triaging the outliers file

The whole point of the outliers file is **manual review**: every row is a sample that was excluded from the recommendation, and each one is either signal or noise.

- **Genuine signal** — same repo, multiple runs, consistent: this consumer probably needs its own larger SKU override. Don't change the default; raise the SKU per-caller.
- **Genuine noise** — broken job (100% failure), infra outage, one-off cold cache: leave excluded. Optionally open an issue against the source repo to fix the broken job.

## Caveats

- The script reads **wall time only**, no CPU/memory metrics. Linear-scaling is assumed and is _conservative_ for IO-bound jobs. For accurate CPU-utilisation data on the warp runners, pair this output with `warpbuild-analysis` (sibling tool).
- The `zupit-agents` vCPU count is unknown from the label; pass `--vcpu-zupit` if your pool isn't 4 vCPU.
- The github-hosted `ubuntu-*` baseline assumes the free 2-vCPU SKU. Pass `--vcpu-gh-default 4` if your org runs the larger-runner add-on.
- The script does **not** modify any `.yml`. Use the markdown report and per-job rollup as the source of truth when tuning runner SKUs by hand.
- Recommendation is deterministic on the same input + flags.
