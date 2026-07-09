# pipeline-templates tools

Standalone CLI utilities for tuning the runner SKUs used by the reusable workflows in this repo.

| Tool                                           | Input                                                                                            | Output                                                                                                                                                         | When to run                                                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [`runner-sizing/`](./runner-sizing/)           | GitHub Actions **Usage data > Export** CSV (wall time, queue time, failure rate, runner labels). | Per-`(workflow, job)` SKU recommendation, plus a rollup by job-ID that maps directly to a pipeline-templates _step_. Outliers are separated for manual review. | After exporting fresh GH Actions usage. Best for cross-runner comparisons (mixed warpbuild / buildjet / zupit-agents / github-hosted pools). |
| [`warpbuild-analysis/`](./warpbuild-analysis/) | Warpbuild **usage-data export** JSON (per-instance CPU%, memory%, disk-io, network-io, fs%).     | Per-`(workflow, job, sku)` `upgrade` / `downgrade` / `keep` action driven by real CPU/memory percentiles.                                                      | When the workload already runs on warpbuild and you have direct per-instance metrics.                                                        |
| [`warpbuild-cost/`](./warpbuild-cost/)         | Warpbuild dashboard **jobs report** CSV + **CI billing** CSV.                                    | Per-`(repo, job, runner_label)` downgrade / arm64-switch recommendation with estimated $ savings over the billing window.                                      | When you want $-quantified savings, including the 25%-cheaper arm64 SKUs, from just the two dashboard CSVs.                                  |

The two tools are complementary:

- **`warpbuild-analysis`** is authoritative for jobs that already run on warpbuild — it sees real CPU/memory %.
- **`runner-sizing`** is best for jobs that _don't_ run on warpbuild yet (still on zupit-agents or github-hosted) — it normalises wall time across runner families using configurable speed factors so the data is comparable. Use its recommendations to set defaults for _new_ migrations, then re-validate with `warpbuild-analysis` once the workload has been on warpbuild for a few sprints.

## Running

All tools are zero-dependency TypeScript scripts that run with any Node-compatible runner. From the repo root:

```bash
npx tsx tools/runner-sizing/analyze.ts <input.csv>                            [options]
npx tsx tools/warpbuild-analysis/analyze.ts <input.json>                      [options]
npx tsx tools/warpbuild-cost/analyze.ts <jobs-report.csv> <ci-billing.csv>    [options]
```

`bun`, `ts-node`, `tsx`, `deno` (with `--allow-read --allow-write`) all work.

## Conventions

- Output files are written next to the input by default (`<input-basename>-{sizing,analysis,outliers}.{json,md}`). Override with `--output <path>` on either tool.
- Markdown output is on by default; pass `--no-md` if you want JSON only.
- Runs are deterministic: same input + flags → byte-identical output. Safe to commit reports.
- Neither tool writes to any `.yml`. Use the markdown reports as the source of truth when editing workflow defaults by hand.

## When the data disagrees

If `runner-sizing` recommends a tier different from `warpbuild-analysis`:

- **`warpbuild-analysis` says `upgrade` but `runner-sizing` says `keep`**: the workload has grown since the CSV window. Trust the warpbuild metrics — they're newer and CPU-true.
- **`runner-sizing` says `upgrade` but `warpbuild-analysis` says `downgrade`**: the workload is IO-bound. The CSV-driven recommendation assumes linear CPU scaling and over-allocates. Trust the warpbuild metrics.
- **Both agree**: act on it.

Document the decision in the workflow file's `description:` or `# NOTE:` comment so the rationale outlives the report.
