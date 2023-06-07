# Zupit Reusable Workflows - Grouped Step Workflows
Here we detail only those workflows that are already grouped inside other workflows, as these workflows should not be used.

If you want to read the main document the click [here](../README.md).

1. [Reusable Workflows](#reusable-workflows)
   1. [NodeJS](#nodejs)
      1. [Lint & Build](#nodejs-lint--build)
      2. [Run Cypress Tests](#nodejs-run-cypress-tests)
   2. [Django](#django)
      1. [Lint & Check](#django-lint--check)
      2. [Run Tests](#django-run-tests)
   3. [SpringBoot](#springboot)
      1. [Lint & Check](#springboot-lint--check)
      2. [Run Tests](#springboot-run-tests)

## Reusable Workflows

### NodeJS

#### NodeJS Lint & Build
###### Requirements
This workflow requires these commands in order to succeed:
1. **ci:format:check**: Check that the code is formatted correctly.
2. **ci:lint**: Check that the code is linted correctly.
3. **ci:build**: Check that the project builds correctly

This workflow uses **npm** as package manager.

###### Workflow
**node-step-format-lint-build.yml** is the reusable workflow to check if the code is linted correctly and that it
builds correctly.

It requires these inputs:
- **LABELS**: the *labels* to select the correct *github-runner* that will execute this workflow. The format is a stringified JSON list of labels.
- **WORKING_DIRECTORY**: The directory where the runner can execute all the commands. This is basically the directory which contains the NodeJS application.
- **NODE_VERSION**: The NodeJS version required to execute all the commands

In addition, it is possible to specify this optional input:
- RUN: Whether to run all the workflow or not. This is useful when you want to skip the workflow since the code didn't change. By default, it is **true**.

This is an example to show how data should be formatted. 
```yaml
jobs:
  node-lint-check-build:
    uses:
      zupit-it/pipeline-templates/.github/workflows/node-step-format-lint-build.yml@v1.0.2
    with:
      LABELS: "['pinga', 'pipeline', 'native']"
      WORKING_DIRECTORY: frontend
      NODE_VERSION: 14.11.0
    secrets: inherit
```

---

#### NodeJS Run Cypress Tests
###### Requirements
This workflow requires this command in order to succeed:
1. **ci:e2e**: Check that all cypress tests pass *(only if tests are enabled)*. 
   This command must generate the coverage report **lcov.info** inside the **coverage** folder in the NodeJS directory.
   (e.g. `frontend/coverage/lcov.info`)

This workflow uses **npm** as package manager.

###### Workflow
**node-step-test-cypress.yml** is the reusable workflow to run and check that all cypress tests pass. 
If all tests pass, it then generates the coverage and save it as artifact so that it is available for tools like Sonarqube.

*This workflow uses a cypress docker image, hence remember to use labels to match runners specific for docker.*

It requires these inputs:
- **LABELS**: the *labels* to select the correct *github-runner* that will execute this workflow. The format is a stringified JSON list of labels.
- **WORKING_DIRECTORY**: The directory where the runner can execute all the commands. This is basically the directory which contains the NodeJS application.
- **CYPRESS_IMAGE**: The Cypress Docker image to run all tests.
- **COVERAGE_ARTIFACT_NAME**: The artifact's name for the *lcov.info* file.

In addition, it is possible to specify this optional input:
- BROWSER: Which browser the cypress should use to run the tests. By default, it is **Chrome**.
- TIMEOUT: If the tests take more than the given time in minutes, Github stops forcefully the workflow. By default, it is **30**.
- RUN: Whether to run all the workflow or not. This is useful when you want to skip the workflow since the code didn't change. By default, it is **true**.


This is an example to show how data should be formatted. 
```yaml
jobs:
  cypress-run:
    uses:
      zupit-it/pipeline-templates/.github/workflows/node-step-test-cypress.yml@v1.0.2
    with:
      LABELS: "['pinga', 'pipeline', 'container']"
      WORKING_DIRECTORY: frontend
      CYPRESS_IMAGE: cypress/browsers:node16.17.0-chrome106
      COVERAGE_ARTIFACT_NAME: lcov.info
    secrets: inherit
```

---

### Django

#### Django Lint & Check
###### Requirements
This workflow requires these files inside the Django directory:
1. **requirements.txt** **Black** and **Flake8** to check the code style.
2. **env.github** with the required environment variables in order to run the checks and tests in the workflows.

This workflow uses **pip** as package manager.

###### Workflow
**django-step-lint-check.yml** is the reusable workflow to check if the code is linted correctly,
run the check command and verify that the migrations are not broken.

*This workflow uses a python docker image, hence remember to use labels to match runners specific for Docker.*

It requires these inputs:
- **LABELS**: the *labels* to select the correct *github-runner* that will execute this workflow. The format is a stringified JSON list of labels.
- **WORKING_DIRECTORY**: The directory where the runner can execute all the commands. This is basically the directory which contains the Django application.
- **PYTHON_IMAGE**: The Python Docker image where the runner execute all the commands

In addition, it is possible to specify this optional input:

-   **SETUP_COMMANDS**: Allow to execute commands before the download of the dependencies. Useful to install packages required for Python dependencies.


In addition, it is possible to specify this optional input:
- RUN: Whether to run all the workflow or not. This is useful when you want to skip the workflow since the code didn't change. By default, it is **true**.

This is an example to show how data should be formatted. 
```yaml
jobs:
  django-lint-check:
    uses:
      zupit-it/pipeline-templates/.github/workflows/django-step-lint-check.yml@v1.0.2
    with:
      LABELS: "['pinga', 'pipeline', 'container']"
      WORKING_DIRECTORY: backend
      PYTHON_IMAGE: python:3.8.2-slim-buster
      SETUP_COMMANDS: "apt update && apt install -y gcc"
    secrets: inherit
```

---

#### Django Run Tests
###### Requirements
This workflow requires these files inside the Django directory:
1. **requirements.txt** with **Coverage** to check the coverage.
2. **env.github** with the required environment variables in order to run the checks and tests in the workflows.

This workflow uses **pip** as package manager.

###### Workflow
**django-step-tests.yml** is the reusable workflow to run and check that all tests pass. 
If all tests pass, it then generates the coverage and save it as artifact so that it is available for tools like Sonarqube.

*This workflow uses a python Docker image, hence remember to use labels to match runners specific for docker.*

It requires these inputs:
- **LABELS**: the *labels* to select the correct *github-runner* that will execute this workflow. The format is a stringified JSON list of labels.
- **WORKING_DIRECTORY**: The directory where the runner can execute all the commands. This is basically the directory which contains the Django application.
- **PYTHON_IMAGE**: The Python Docker image where the runner execute all the commands
- **COVERAGE_ARTIFACT_NAME**: The artifact's name for the *coverage-django.xml* file.

In addition, it is possible to specify this optional input:

-   **SETUP_COMMANDS**: Allow to execute commands before the download of the dependencies. Useful to install packages required for Python dependencies.


In addition, it is possible to specify this optional input:
- RUN: Whether to run all the workflow or not. This is useful when you want to skip the workflow since the code didn't change. By default, it is **true**.

This is an example to show how data should be formatted. 
```yaml
jobs:
  django-step-tests:
    uses:
      zupit-it/pipeline-templates/.github/workflows/django-step-tests.yml@v1.0.2
    with:
      LABELS: "['pinga', 'pipeline', 'container']"
      WORKING_DIRECTORY: backend
      PYTHON_IMAGE: python:3.8.2-slim-buster
      COVERAGE_ARTIFACT_NAME: coverage-django.xml
      SETUP_COMMANDS: "apt update && apt install -y gcc"
    secrets: inherit
```

---

### SpringBoot

#### SpringBoot Lint & Check
###### Requirements
This workflow requires **Spotless** & **Checkstyle** plugins to check that formatting and coding style are correct.

This workflow uses **maven** as package manager.

###### Workflow
**springboot-step-lint-check.yml** is the reusable workflow to check if the code is linted and formatted correctly.

*This workflow uses a Java docker image, hence remember to use labels to match runners specific for Docker.*

It requires these inputs:
- **LABELS**: the *labels* to select the correct *github-runner* that will execute this workflow. The format is a stringified JSON list of labels.
- **WORKING_DIRECTORY**: The directory where the runner can execute all the commands. This is basically the directory which contains the Django application.
- **JAVA_IMAGE**: The Java Docker image where the runner execute all the commands.

In addition, it is possible to specify this optional input:
- MAVEN_USER_HOME: The path to Maven directory. By default, it is **./m2**.
- EXTRA_MAVEN_ARGS: Additional arguments for Maven. By default, it is **""**.
- RUN: Whether to run all the workflow or not. This is useful when you want to skip the workflow since the code didn't change. By default, it is **true**.

This is an example to show how data should be formatted. 
```yaml
jobs:
  springboot-lint-check:
    uses:
      zupit-it/pipeline-templates/.github/workflows/springboot-step-lint-check.yml
    with:
      LABELS: "['pinga', 'pipeline', 'container']"
      JAVA_IMAGE: openjdk:12
      WORKING_DIRECTORY: backend
    secrets: inherit
```

---

#### SpringBoot Run Tests
###### Requirements
This workflow requires **Jacoco** plugin to create report from tests. 
In addition, the maven command *Verify* should generate coverage reports.

This workflow uses **maven** as package manager.

###### Workflow
**springboot-step-tests.yml** is the reusable workflow to run and check that all tests pass. 
If all tests pass, it then generates the coverage reports and save them as artifact so that they are available for tools like Sonarqube.

*This workflow uses a Java Docker image, hence remember to use labels to match runners specific for docker.*

It requires these inputs:
- **LABELS**: the *labels* to select the correct *github-runner* that will execute this workflow. The format is a stringified JSON list of labels.
- **WORKING_DIRECTORY**: The directory where the runner can execute all the commands. This is basically the directory which contains the Django application.
- **JAVA_IMAGE**: The Java Docker image where the runner execute all the commands.

In addition, it is possible to specify this optional input:
- COVERAGE_ARTIFACT_NAME: The artifact's name for the *jacoco reports* file. By default, it is **target**.
- MAVEN_USER_HOME: The path to Maven directory. By default, it is **./m2**.
- EXTRA_MAVEN_ARGS: Additional arguments for Maven. By default, it is **""**.
- USE_CI_POSTGRES: Whether to use Postgres for tests or not. If enabled, it injects the connection string to the DB for tests. By default, it is **true**.
- RUN: Whether to run all the workflow or not. This is useful when you want to skip the workflow since the code didn't change. By default, it is **true**.


This is an example to show how data should be formatted. 
```yaml
jobs:
  springboot-tests:
    uses:
      zupit-it/pipeline-templates/.github/workflows/springboot-step-tests.yml
    with:
      LABELS: "['pinga', 'pipeline', 'container']"
      JAVA_IMAGE: openjdk:12
      WORKING_DIRECTORY: backend
    secrets: inherit
```
