# Change Detection Pattern for GitHub Workflows

This pattern allows workflows to run only when relevant changes are detected in specific directories. This optimization helps reduce unnecessary workflow runs and saves CI/CD resources.

## Overview

The pattern consists of three main components:

1. A change detection job that checks for modifications in specified directories
2. Conditional execution of workflow jobs based on the detection results
3. A job status validation step that runs even if jobs are skipped

## Implementation Guide

### 1. Add Required Input Parameters

Add these parameters to your workflow's `workflow_call` inputs:

```yaml
inputs:
    CHECK_WORKDIR_CHANGES:
        required: true
        type: boolean
        default: false
        description: "When true, enables change detection. When false, always runs jobs"

    CHECK_CUSTOM_DIR:
        required: false
        type: string
        default: ""
        description: "Override directory to check for changes. Defaults to WORKING_DIRECTORY if empty"

    CHECK_CHANGES_BY_JOBS:
        required: false
        type: string
        default: "all"
        description: "JSON array of job IDs to run change detection for. The default 'all' runs for all jobs"
```

### 2. Set Up Environment Variables

Add this environment configuration at the workflow level:

```yaml
env:
    CHECK_DIR: ${{ inputs.WORKING_DIRECTORY }} # Base directory for change detection
    # Add your other environment variables here
```

### 3. Add the Change Detection Job

Add this job to check for directory changes:

```yaml
jobs:
    workdir-has-changes:
        runs-on: ubuntu-latest
        outputs:
            changes-detected: ${{ steps.filter.outputs.changes-detected }}
        steps:
            - name: Set CHECK_DIR to custom directory if provided
              if: ${{ inputs.CHECK_CUSTOM_DIR != '' }}
              run: echo "CHECK_DIR=${{ inputs.CHECK_CUSTOM_DIR }}" >> $GITHUB_ENV
            - name: Set default CHECK_DIR
              if: ${{ inputs.CHECK_CUSTOM_DIR == '' }}
              run: echo "CHECK_DIR=${{ inputs.WORKING_DIRECTORY }}" >> $GITHUB_ENV

            - uses: actions/checkout@v4
            - uses: dorny/paths-filter@v3
              id: filter
              with:
                  filters: |
                      changes-detected:
                        - "${{ env.CHECK_DIR }}/**"
```

### 4. Update Your Main Jobs

Modify your workflow jobs to use change detection:

```yaml
jobs:
    your-job-name:
        needs: workdir-has-changes
        if: ${{ !inputs.CHECK_WORKDIR_CHANGES || (needs.workdir-has-changes.outputs.changes-detected == 'true' && (inputs.CHECK_CHANGES_BY_JOBS == 'all' || contains(fromJson(inputs.CHECK_CHANGES_BY_JOBS), github.job)))}}
        runs-on: ubuntu-latest
        steps:
            # Your job steps here
```

### 5. Add the Success Validation Job

Add this job to validate the overall workflow status:

```yaml
jobs:
    jobs-succeded:
        needs: ["your-job-name"] # List all jobs that need validation
        runs-on: ubuntu-latest
        if: ${{ always() }}
        steps:
            - name: "Check if jobs succeeded"
              run: if [[ "${{ needs.your-job-name.result }}" == "failure" ]]; then exit 1; fi
```

## Usage Examples

### Basic Usage

```yaml
name: Example Workflow
on:
    workflow_call:
        inputs:
            WORKING_DIRECTORY:
                required: true
                type: string
            CHECK_WORKDIR_CHANGES:
                required: true
                type: boolean
                default: false
            CHECK_CUSTOM_DIR:
                required: false
                type: string
                default: ""
            CHECK_CHANGES_BY_JOBS:
                required: false
                type: string
                default: "all"

env:
    CHECK_DIR: ${{ inputs.WORKING_DIRECTORY }}

jobs:
    workdir-has-changes:
        # Change detection job configuration as above

    main-job:
        needs: workdir-has-changes
        if: ${{ !inputs.CHECK_WORKDIR_CHANGES || (needs.workdir-has-changes.outputs.changes-detected == 'true' && (inputs.CHECK_CHANGES_BY_JOBS == 'all' || contains(fromJson(inputs.CHECK_CHANGES_BY_JOBS), github.job)))}}
        runs-on: ubuntu-latest
        steps:
            - run: echo "Main job running"

    jobs-succeded:
        needs: ["main-job"]
        # Success validation job configuration as above
```

### Advanced Usage

1. To run only specific jobs when changes are detected:

```yaml
with:
    CHECK_WORKDIR_CHANGES: true
    CHECK_CHANGES_BY_JOBS: "['build', 'test']"
```

2. To check a different directory than the working directory:

```yaml
with:
    CHECK_WORKDIR_CHANGES: true
    CHECK_CUSTOM_DIR: "src/frontend"
```

3. To disable change detection and run all jobs:

```yaml
with:
    CHECK_WORKDIR_CHANGES: false
```

## Important Notes

1. The `CHECK_WORKDIR_CHANGES` parameter acts as a master switch:

    - When `false`: All jobs run regardless of changes
    - When `true`: Jobs only run if changes are detected

2. The `CHECK_CUSTOM_DIR` parameter allows checking a different directory than `WORKING_DIRECTORY`

3. The `CHECK_CHANGES_BY_JOBS` parameter controls which jobs use change detection:

    - Default `"all"`: All jobs use change detection
    - JSON array of job IDs: Only listed jobs use change detection

4. The success validation job (`jobs-succeded`) should list all workflow jobs in its `needs` array

5. Branch protection rules should reference the `jobs-succeded` job, not individual workflow jobs

6. The `CHECK_DIR` environment variable is used as the base directory for change detection and can be overridden by `CHECK_CUSTOM_DIR`
