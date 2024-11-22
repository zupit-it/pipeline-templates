# Using `CACHE_SUFFIX` in GitHub Actions Pipelines

## Overview

The `CACHE_SUFFIX` is a customizable string that can be appended to cache keys within GitHub Actions workflows. It is useful when managing build or dependency caches across different branches, workflows, or environments. By appending a `CACHE_SUFFIX`, you can avoid cache collisions and control cache versions effectively.

## Why use `CACHE_SUFFIX`?

-   **Branch-Specific Caches**: When working with multiple branches in a repository, the `CACHE_SUFFIX` allows you to isolate caches per branch. This prevents overwriting the cache from one branch to another and ensures that the appropriate cached data is available during the workflow.

-   **Workflow-Specific Caches**: If you have different workflows for testing, building, or deploying your project, the `CACHE_SUFFIX` can differentiate caches between them. This ensures that the data cached in one workflow does not affect another.

-   **Cache Invalidation**: In case of significant changes in your pipeline or dependencies, you can invalidate the cache by changing the `CACHE_SUFFIX`, forcing GitHub Actions to create a fresh cache for the next run.

## How to implement `CACHE_SUFFIX` on a new workflow

To implement the `CACHE_SUFFIX` in a GitHub Actions pipeline, you need to include it in the `key` field when defining your cache step. Below is an example of how to incorporate `CACHE_SUFFIX` for a Node.js project.

### Example

```yaml
name: Node.js CI

on:
push:
branches: - main
pull_request:
branches: - main

jobs:
build:
runs-on: ubuntu-latest

    steps:
    - uses: actions/checkout@v2

    - name: Cache node modules
      uses: actions/cache@v2
      with:
        path: node_modules
        key: ${{ runner.os }}-node-${{ hashFiles('package-lock.json') }}-cache_${{ env.CACHE_SUFFIX }}
        restore-keys: |
          ${{ runner.os }}-node-${{ hashFiles('package-lock.json') }}-

    - name: Install dependencies
      run: npm install

    - name: Run tests
      run: npm test

```

In this example:

-   `CACHE_SUFFIX` is an environment variable that can be set per branch or workflow, ensuring unique cache keys for different contexts.
-   The `key` uses the operating system (`runner.os`), hash of `package-lock.json`, and the `CACHE_SUFFIX` to generate a unique cache key.
-   This allows you to differentiate caches, either by workflow, branch, or specific version of dependencies.

### Setting the `CACHE_SUFFIX`

You can set the `CACHE_SUFFIX` dynamically depending on your workflow needs. For example:

```yaml
env:
CACHE_SUFFIX: ${{ github.ref_name }}
```

This will use the branch name as the suffix, ensuring that each branch has its own cache.

## Example: Cache Invalidation on Dependency Update

To automatically invalidate the cache when dependencies are updated, you can hash your dependency file (e.g., `package-lock.json`) and include `CACHE_SUFFIX`.

```yaml
key: ${{ runner.os }}-node-${{ hashFiles('package-lock.json') }}-cache_${{ env.CACHE_SUFFIX }}
```

If the dependencies change, the hash of `package-lock.json` will change, thus creating a new cache entry without manual intervention.
