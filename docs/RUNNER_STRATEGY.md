# Runner strategy: WarpBuild

How reusable workflows in this repo choose a runner.

## TL;DR

- **Every job runs on WarpBuild** — on-demand cloud runners
  (`warp-ubuntu-latest-<arch>-<size>`), billed per minute with a 1-minute
  minimum.
- **`runs-on:` is always a flat single label**, driven by an input:
  `runs-on: ${{ inputs.RUN_ON }}`.
- **Size the runner per workload.** Cheap gate jobs default to
  `warp-ubuntu-latest-arm64-2x`; build / lint / test / analyze jobs default to a
  larger x64 or arm64 SKU. All defaults are overridable per call.
- The self-hosted `zupit-agents` pool is **not used** by these templates. If you
  are considering it again, read [the appendix](#appendix-the-self-hosted-zupit-agents-detour)
  first — it costs more than the label change.

## Input convention

| Input                     | Drives                                                                        | Default                       |
| ------------------------- | ----------------------------------------------------------------------------- | ----------------------------- |
| `RUN_ON`                  | cheap jobs: `workdir-has-changes`, `jobs-succeded`, jira, commit-lint, deploy | `warp-ubuntu-latest-arm64-2x` |
| `RUN_ON_BUILD`            | build / compile / bundle jobs                                                 | larger WarpBuild SKU          |
| `RUN_ON_LINT`             | lint jobs                                                                     | larger WarpBuild SKU          |
| `RUN_ON_ANALYZE`          | sonar-analyze job                                                             | larger WarpBuild SKU          |
| `RUNNERS_CONTAINER_GROUP` | **unused** — legacy input, kept so existing callers don't break               | `Container`                   |

All inputs are `required: false` with a default — **a caller can override any of
them per call.** Consumers that don't pass anything inherit these defaults, so a
default change here propagates to every repo on this branch.

## Choosing arch and size

- **arm64 is the cheaper flavor** and is the default wherever the job is
  arch-safe (shell, git, node, dotnet). Prefer it.
- **x64 is required** when the job produces or consumes an amd64 artifact, or
  when a JS action / container image has no arm64 build. Two known cases:
    - **Docker image builds** use plain `docker build` (no `--platform`), so the
      image arch follows the runner arch. Images that must be `linux/amd64`
      (e.g. a Keycloak image bundling an amd64 `promtail` binary) stay on x64.
      An arm64 runner silently produces a broken image.
    - **glibc-only tool images** — `mcr.microsoft.com/azure-cli` must be the
      `azurelinux`/glibc tag, not alpine, or the bundled JS actions fail to run
      on arm64.
- **Size from real data, not intuition.** `tools/warpbuild-analysis/` turns a
  WarpBuild usage export into per-`(workflow, job, sku)` upgrade / downgrade /
  keep recommendations with CPU and memory p95s.

## Checklist when adding or moving a job

- **Flat `runs-on: ${{ inputs.RUN_ON* }}`** — never the `labels:` + `group:`
  block; that form only targets self-hosted runner groups and will leave the job
  unschedulable on WarpBuild.
- **Arch-safe?** → arm64. **Produces amd64 artifacts / needs a glibc-only
  image?** → x64.
- **Needs a toolchain?** → either a `container:` image that ships it or the
  matching `actions/setup-*` step. Both work on WarpBuild; the setup actions can
  write the tool cache here.
- **Sub-minute job?** It still costs a full minute. That is accepted — see the
  appendix for why chasing it was not worth it.

## Appendix: the self-hosted `zupit-agents` detour

For a period the cheap sub-minute jobs (`workdir-has-changes` ~20s,
`jobs-succeded` ~5s, `jira-*`, `conventional-commits` lint ~9s) were pointed at
the free self-hosted `zupit-agents` pool to dodge WarpBuild's 1-minute minimum.
That has been reverted; everything is back on WarpBuild. Keeping the notes here
because the wiring is non-obvious and the next person to try will hit the same
walls.

Targeting the self-hosted pool takes **two** coordinated changes, and doing only
one leaves the job unschedulable:

1. the label default (`RUN_ON: "zupit-agents"`), **and**
2. the grouped `runs-on:` form — those runners live in the `Container` runner
   group and a bare `runs-on: zupit-agents` does not reliably reach them:

```yaml
runs-on:
    labels: ${{ inputs.RUN_ON }} # zupit-agents
    group: ${{ inputs.RUNNERS_CONTAINER_GROUP }} # Container
```

On top of that, **every** self-hosted job needs a `container:`. The runners
execute jobs as a non-root user that cannot write the runner's tool cache, so
any `actions/setup-*` step fails on the host:

```
EACCES: permission denied, mkdir '/opt/github-runner/.../_work/_tool/node/24.18.0'
```

Inside a container the steps run as root, so tool installs and the checkout's
git work. That constraint drove a set of per-job workarounds — `container:
node:24` instead of `actions/setup-node`, `container: buildpack-deps:24.04-scm`
plus an `apt-get install jq` step for git/jq jobs, and jobs needing the `gh` CLI
had to stay on WarpBuild because `gh` is not in the standard images. Docker
builds also could not move: they need privileged docker-in-docker and an amd64
host.

Net: the savings were confined to jobs measured in seconds, while every one of
them acquired an image pin and a bespoke tool-install step. The flat WarpBuild
label is the simpler default.
