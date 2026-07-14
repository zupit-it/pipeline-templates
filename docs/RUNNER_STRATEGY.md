# Runner strategy: WarpBuild vs self-hosted (`zupit-agents`)

How reusable workflows in this repo choose a runner, and the one wiring detail
that is easy to get wrong.

## TL;DR

- **Two runner backends** are used side by side:
    - **`zupit-agents`** — our free self-hosted pool (runner group `Container`).
    - **WarpBuild** — on-demand cloud runners (`warp-ubuntu-latest-<arch>-<size>`),
      billed **per minute, 1-minute minimum**.
- **Cheap, sub-minute jobs run on `zupit-agents`.** A 5–20s gate job billed a
  full WarpBuild minute is pure waste, so those go to the self-hosted pool.
- **Heavy jobs (build / lint / test / sonar-analyze / docker build) run on
  WarpBuild**, sized per workload.
- **The `runs-on:` wiring is different for the two backends.** Getting it wrong
  silently sends a job to the wrong pool (or leaves it unschedulable). See the
  gotcha below.

## Why the split exists

WarpBuild charges a **1-minute minimum per job**. The pipelines fan out into
many tiny orchestration/gate jobs — `workdir-has-changes` (~20s), `jobs-succeded`
(~5s), `jira-*`, `conventional-commits` lint (~9s), tag/version helpers — that
run hundreds of times a week. Each one billed a full minute dwarfs its real
cost. Those jobs are CPU-trivial, so they belong on the free self-hosted pool.

The heavy jobs (compile, bundle, sonar scan, docker build) genuinely need cores
and are not sub-minute, so they stay on WarpBuild where we can size them.

## The gotcha: `runs-on:` wiring differs by backend

**Self-hosted `zupit-agents`** must be targeted with the **labels + group** block:

```yaml
runs-on:
    labels: ${{ inputs.RUN_ON }} # zupit-agents
    group: ${{ inputs.RUNNERS_CONTAINER_GROUP }} # Container
```

**WarpBuild** is targeted with a **flat single label**:

```yaml
runs-on: ${{ inputs.RUN_ON_BUILD }} # e.g. warp-ubuntu-latest-x64-4x
```

> A bare `runs-on: zupit-agents` (label only, no `group:`) does **not** reliably
> reach the self-hosted pool — those runners live in the `Container` group and
> are selected with the `labels`+`group` form. `main` has always used the
> grouped form; a WarpBuild migration that flattens every `runs-on:` to a single
> label will break self-hosted scheduling for the cheap jobs. When moving a job
> back to `zupit-agents`, restore the grouped block **and** set the label
> default — doing only one is not enough.

## Input convention

| Input                     | Drives                                                                        | Default (cheap→self-hosted / heavy→WarpBuild) | `runs-on:` form    |
| ------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------- | ------------------ |
| `RUN_ON`                  | cheap jobs: `workdir-has-changes`, `jobs-succeded`, jira, commit-lint, deploy | `zupit-agents`                                | labels + group     |
| `RUNNERS_CONTAINER_GROUP` | runner group for the self-hosted jobs                                         | `Container`                                   | (used as `group:`) |
| `RUN_ON_BUILD`            | build / compile / bundle jobs                                                 | WarpBuild string                              | flat label         |
| `RUN_ON_LINT`             | lint jobs                                                                     | WarpBuild string                              | flat label         |
| `RUN_ON_ANALYZE`          | sonar-analyze job                                                             | WarpBuild string                              | flat label         |

All inputs are `required: false` with a default — **a caller can override any of
them per call.** Consumers that don't pass anything inherit these defaults, so a
default change here propagates to every repo on this branch.

## Which jobs go where

- **Self-hosted (`RUN_ON`, grouped):** the gate/orchestration jobs in the
  `*-workflow-common` files, the `workdir-has-changes` + `jobs-succeded` jobs in
  the `sonar-step-*-analyze` files, the `jira-*` and `conventional-commits-step-*`
  workflows, `docker-step-delete-images`, and the deploy jobs in the
  `*-build-and-deploy` / `azure-webapp-code-deploy` workflows (CPU-light, and
  free self-hosted beats paying WarpBuild for a multi-minute deploy).
- **WarpBuild (`RUN_ON_BUILD` / `RUN_ON_LINT` / `RUN_ON_ANALYZE`, flat):** the
  build / lint / test / cypress / sonar-analyze jobs, plus **all docker image
  builds** (`docker-step-build-and-push-image*`, `springboot-step-docker-*`,
  `node-step-docker-*`).

### Docker builds stay on WarpBuild

Two reasons, both hard blockers for the self-hosted `Container` runners:

1. **Privileged docker-in-docker** — the build job runs a DinD container with
   `--privileged`; the self-hosted runners are not guaranteed to support that.
2. **Architecture** — the builds use plain `docker build` (no `--platform`), so
   the image arch follows the runner arch. They must produce `linux/amd64`
   images (e.g. the Keycloak image bundles an amd64 `promtail` binary), so they
   stay on x64 WarpBuild. An arm64 runner would silently produce a broken image.

## Checklist when adding or moving a job

- **Sub-minute + CPU-light?** → `zupit-agents`, grouped `runs-on:` (labels+group).
- **Heavy / not sub-minute?** → WarpBuild via `RUN_ON_BUILD`/`_LINT`/`_ANALYZE`,
  flat `runs-on:`.
- **Polls or waits** (e.g. a migrator-trigger that retries, or a long deploy)? It
  is _not_ sub-minute — judge by real p90, not by CPU. Keep long pollers on
  WarpBuild.
- **Needs docker/privileged?** → WarpBuild (see above).
- **Runs directly on the host (no `container:`)?** Confirm the self-hosted
  runners have the tools it calls (`git`, `gh`, `node`, …); the `Container` group
  name refers to the runner group, not to auto-provisioned tooling.

## How the target list was derived

Job durations came from a jobs-usage CSV export (per `workflow / job` with
`run_count`, `success_rate`, `duration_p75/p90` in **seconds**). "Sub-minute" =
`duration_p90 < 60`. The highest-volume offenders are `jobs-succeded` (~5s) and
`workdir-has-changes` (~20s), which recur in almost every pipeline — those are
where the 1-minute-floor savings are largest.
