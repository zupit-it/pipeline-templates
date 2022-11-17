# Zupit Reusable Workflows - Grouped Step Workflows
Here we detail only those workflows that are already grouped inside other workflows, as these should be used only in
specific cases, as the other ones are the *standard* workflows to use.

If you want to read the main document the click [here](../README.md).

1. [Reusable Workflows](#reusable-workflows)
   1. [Django](#django)
      1. [Lint & Check](#django-lint--check)
      2. [Run Tests](#django-run-tests)
   2. [NodeJS](#nodejs)
      1. [Lint & Build](#nodejs-lint--build)
      2. [Run Cypress Tests](#nodejs-run-cypress-tests)

## Reusable Workflows

### Django

#### Django Lint & Check
**django-step-lint-check.yml** is the reusable workflow to check if the code is linted correctly,
run the check command and verify that the migrations are not broken.

*This workflow uses a python docker image, hence remember to use labels to match runners specific for docker.*

It requires these inputs:
- LABELS: the *labels* to select the correct *github-runner* that will execute this workflow. The format is a stringified JSON list of labels.
- WORKING_DIRECTORY: The directory where the runner can execute all the commands.
- PYTHON_IMAGE: The Python Docker image where the runner execute all the commands

This is an example to show how data should be formatted. 
```yaml
jobs:
  django-lint-check:
    uses:
      zupit-it/pipeline-templates/.github/workflows/django-step-lint-check.yml@main
    with:
      LABELS: "['pinga', 'pipeline', 'container']"
      WORKING_DIRECTORY: backend
      PYTHON_IMAGE: python:3.8.2-slim-buster
    secrets: inherit
```

---

#### Django Run Tests
**django-step-tests.yml** is the reusable workflow to run and check that all tests pass. 
If all tests pass, it then generates the coverage and save it as artifact so that it is available for tools like Sonarqube.

*This workflow uses a python docker image, hence remember to use labels to match runners specific for docker.*

It requires these inputs:
- LABELS: the *labels* to select the correct *github-runner* that will execute this workflow. The format is a stringified JSON list of labels.
- WORKING_DIRECTORY: The directory where the runner can execute all the commands.
- PYTHON_IMAGE: The Python Docker image where the runner execute all the commands
- COVERAGE_ARTIFACT_NAME: The artifact's name for the *coverage-django.xml* file.

This is an example to show how data should be formatted. 
```yaml
jobs:
  django-step-tests:
    uses:
      zupit-it/pipeline-templates/.github/workflows/django-step-tests.yml@main
    with:
      LABELS: "['pinga', 'pipeline', 'container']"
      WORKING_DIRECTORY: backend
      PYTHON_IMAGE: python:3.8.2-slim-buster
      COVERAGE_ARTIFACT_NAME: coverage-django.xml
    secrets: inherit
```

---

### NodeJS
The NodeJS workflows require these commands in order to succeed:
1. **ci:format:check**: Check that the code is formatted correctly.
2. **ci:lint**: Check that the code is linted correctly.
3. **ci:build**: Check that the code builds correctly
4. **ci:e2e**: Check that all tests pass
5. **build:{environment}**: Build the code based on the target **environment** (e.g. *testing*, *staging* and *production*)

#### NodeJS Lint & Build
**node-step-format-lint-build.yml** is the reusable workflow to check if the code is linted correctly and that it
builds correctly.

It requires these inputs:
- LABELS: the *labels* to select the correct *github-runner* that will execute this workflow. The format is a stringified JSON list of labels.
- WORKING_DIRECTORY: The directory where the runner can execute all the commands.
- NODE_VERSION: The NodeJS version required to execute all the commands

This is an example to show how data should be formatted. 
```yaml
jobs:
  node-lint-check-build:
    uses:
      zupit-it/pipeline-templates/.github/workflows/node-step-format-lint-build.yml@main
    with:
      LABELS: "['pinga', 'pipeline', 'native']"
      WORKING_DIRECTORY: frontend
      NODE_VERSION: 14.11.0
    secrets: inherit
```

---

#### NodeJS Run Cypress Tests
**node-step-test-cypress.yml** is the reusable workflow to run and check that all cypress tests pass. 
If all tests pass, it then generates the coverage and save it as artifact so that it is available for tools like Sonarqube.

*This workflow uses a cypress docker image, hence remember to use labels to match runners specific for docker.*

It requires these inputs:
- LABELS: the *labels* to select the correct *github-runner* that will execute this workflow. The format is a stringified JSON list of labels.
- WORKING_DIRECTORY: The directory where the runner can execute all the commands.
- CYPRESS_IMAGE: The Cypress Docker image to run all tests.
- COVERAGE_ARTIFACT_NAME: The artifact's name for the *lcov.info* file.

In addition, it is possible to specify these optional inputs:
- BROWSER: Which browser the cypress should use to run the tests. By default, it is **Chrome**.

This is an example to show how data should be formatted. 
```yaml
jobs:
  cypress-run:
    uses:
      zupit-it/pipeline-templates/.github/workflows/node-step-test-cypress.yml@main
    with:
      LABELS: "['pinga', 'pipeline', 'container']"
      WORKING_DIRECTORY: frontend
      CYPRESS_IMAGE: cypress/browsers:node16.17.0-chrome106
      COVERAGE_ARTIFACT_NAME: lcov.info
    secrets: inherit
```
