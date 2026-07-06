# warpbuild-analysis

CLI that turns a Warpbuild usage-data export (`.json`) into a per-`(workflow, job, sku)` report with a recommended runner SKU action: **upgrade**, **downgrade**, or **keep**.

Outputs two files:

- `<output>.json` — machine-readable rows with full stats (CPU/mem/fs/disk/net p95 + avg, label counts, action, target tier, reason).
- `<output>.md` — markdown report grouped by action, ready to paste into a PR or ticket.

## When to run

- After exporting fresh Warpbuild usage data, to decide which runner SKUs to bump up or scale down in `.github/workflows/*.yml`.
- When you want to re-evaluate the SKU mix over a specific window (e.g. only the last sprint).

## Run

```bash
npx tsx tools/warpbuild-analysis/analyze.ts <input.json> [options]
```

Works with `bun`, `npx tsx`, `ts-node`, or any Node-compatible runtime. No dependencies.

### Options

| Flag              | Effect                                                                                                                                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--from <iso>`    | Only include instances with `started_at >= ISO date` (e.g. `2026-04-01` or `2026-04-01T00:00:00Z`).                                                                                                                   |
| `--to <iso>`      | Only include instances with `started_at <= ISO date`.                                                                                                                                                                 |
| `--output <path>` | Output base path. Writes `<path>.json` and `<path>.md`. Default: `<input-basename>-analysis`.                                                                                                                         |
| `--no-md`         | Skip the markdown output. JSON only.                                                                                                                                                                                  |
| `--drop-epoch`    | Drop instances whose `started_at` is `1970-01-01T00:00:00Z` (Warpbuild emits these for runs that never reported metrics). Default: keep them. When `--from`/`--to` is set, epoch instances are dropped automatically. |
| `-h`, `--help`    | Print usage and exit.                                                                                                                                                                                                 |

### Examples

Plain run on a full export:

```bash
npx tsx tools/warpbuild-analysis/analyze.ts y.json
# Wrote y-analysis.json (45 groups)
# Wrote y-analysis.md
```

Limit to a window and write to a custom path:

```bash
npx tsx tools/warpbuild-analysis/analyze.ts y.json \
  --from 2026-04-01 --to 2026-04-30 \
  --output reports/april-runner-tuning
```

JSON only (no markdown):

```bash
npx tsx tools/warpbuild-analysis/analyze.ts y.json --no-md
```

Drop unreported runs even without a date range:

```bash
npx tsx tools/warpbuild-analysis/analyze.ts y.json --drop-epoch
```

## Classification rules

Per `(repo, workflow, job, sku)` group:

| Action      | Condition                                                                                        | Target tier               |
| ----------- | ------------------------------------------------------------------------------------------------ | ------------------------- |
| `upgrade`   | `high_cpu_frac >= 33%` **and** `cpu_p95 >= 90`                                                   | `tier * 2` (cap **16x**)  |
| `downgrade` | every instance labelled `Low resource usage` **and** no `High Disk IO` / `High Network IO` label | `tier / 2` (floor **2x**) |
| `keep`      | everything else                                                                                  | same tier                 |

Where:

- `high_cpu_frac` = share of instances with label `High CPU Usage`.
- `cpu_p95` / `mem_p95` = nearest-rank 95th percentile across the group (`index = ceil(0.95 * N) - 1`, ascending sort).
- `label` counts come from Warpbuild's `instances[].label` field.
- Tier is parsed from the trailing `-Nx` of the SKU display name (e.g. `warp-ubuntu-latest-x64-4x` → 4); upgrade/downgrade keep the same SKU prefix and only swap the `Nx` suffix.

## JSON shape

```json
{
    "rows": [
        {
            "repository": "acme/example-api",
            "workflow": "Pull request workflow",
            "job": "pr / backend-common / Run .NET build, check formatting and test",
            "sku": "warp-ubuntu-latest-x64-4x",
            "tier": 4,
            "instances": 25,
            "labels": { "High CPU Usage": 22, "Low resource usage": 3 },
            "cpuAvg": 81.29,
            "cpuP95": 95.09,
            "memAvg": 22.57,
            "memP95": 27.89,
            "fsP95": 42.07,
            "diskIoP95": 225915451,
            "netIoP95": 28805348,
            "action": "upgrade",
            "target": 8,
            "reason": "high_cpu_frac=88% cpu_p95=95.1"
        }
    ]
}
```

## Input shape

The script expects the standard Warpbuild export:

```json
{
    "organization_id": "…",
    "repositories": [
        {
            "repository": "owner/repo",
            "workflows": [
                {
                    "workflow_name": "…",
                    "jobs": [
                        {
                            "job_name": "…",
                            "skus": [
                                {
                                    "display_name": "warp-ubuntu-latest-x64-4x",
                                    "instances": [
                                        {
                                            "started_at": "2026-05-07T09:49:13Z",
                                            "label": "High CPU Usage",
                                            "max_sustained_cpu": 95.1,
                                            "max_memory_utilization": 27.9,
                                            "max_filesystem_utilization": 38.5,
                                            "max_sustained_disk_io_bytes": 1234567,
                                            "max_sustained_network_bytes": 89012
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ]
        }
    ]
}
```

Missing numeric fields are treated as `0`. Missing `label` falls back to `"Unlabeled"`.

## Notes

- The script is deterministic and reproducible — running it on the same input twice yields byte-identical output (rows are sorted by workflow + job).
- It does **not** modify your workflow YAML. Use the markdown report as the source of truth when tuning runner SKUs by hand.
- The thresholds match the ones used to produce `y-analysis.json` for the May 2026 SKU tuning; adjust the `classify()` function in `analyze.ts` if you want to retune them.
