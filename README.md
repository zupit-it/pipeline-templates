# Zupit Reusable Workflows
This repository contains reusable workflows to check, build, and deploy our projects.

Here we list only the workflows to be referenced externally with some examples of how to implement them.
The reason why we skip some workflows is due to the fact that these are already included inside other workflows 
in order to reduce boilerplate when writing the final workflows.
If you would like to get more details of these tasks, just look at this [doc](docs/GROUPED_STEP_WORKFLOWS.md).

1. [Naming Convention](#naming-convention)
2. [Reusable Workflows](#reusable-workflows)
   1. [NodeJS](#nodejs)
      1. [Common NodeJS](#nodejs-common)
      2. [Build Docker Image and Push to Registry](#nodejs-build-docker-image-and-push-to-registry)
   2. [Django](#django)
      1. [Common Workflow](#django-common)
   3. [SpringBoot](#springboot)
      1. [Common SpringBoot](#springboot-common)
      2. [Build Docker Image and Push to Registry](#springboot-build-docker-image-and-push-to-registry)
   4. [Docker](#docker)
      1. [Build Docker Image and Push to Registry](#docker-build-docker-image-and-push-to-registry)
      2. [Deploy Docker Compose](#deploy-docker-compose)
      3. [Delete Docker Images](#delete-docker-images)
   5. [Jira](#jira)
      1. [Jira Move Issue](#jira-move-issue)
      2. [Jira Create TODO Issue](#jira-create-todo-issue)
   6. [Others](#others)
      1. [Sonar Analyze](#sonar-analyze)

## Naming convention

We've defined 2 different types of workflows:
- **step**: a *reusable workflow* that *runs a set of specific tasks* that can be grouped together
  (e.g. checking if the project is linted and builds, run the tests, build and push a docker image, ...).
- **workflow**: a *reusable workflow* that *contains a set of our "steps" workflows* to reduce the boilerplate when writing the final workflows.
  One of the use cases is to check if the code is linted, it builds correctly and the tests pass, as this is used in almost all of our projects.

Our reusable workflows are named to follow this standard:

`<technology-or-application>-<workflow-type>-<action-to-execute>.yml`

Thus, it is easy to understand that the workflows uses a specific technology or application to execute the desired action.

## Reusable Workflows
In all the examples, we set *secrets: inherit* to pass all secrets to the reusable workflows, but it is also possible to pass only a subset of secrets.

In addition, we added for all *step* workflows the input *LABELS* as GitHub does not allow to set the *runs-on* from the caller side, but only inside
the reusable workflows. As we want to define the runners as late as possible, we decided to add this input variable.

In the *workflow* type, you will note that we defined 2 inputs for the labels: NATIVE_LABELS and CONTAINER_LABELS. 
We had to differentiate as GitHub runners might start to raise permissions errors due to Docker being run as root. 
To fix this problem, workflows using docker images must use different runners from workflows running commands directly on the host.

### NodeJS - Backend & Frontend

#### NodeJS Common

###### Requirements
This workflow requires these commands in order to succeed:
1. **ci:format:check**: Check that the code is formatted correctly.
2. **ci:lint**: Check that the code is linted correctly.
3. **ci:build**: Check that the project builds correctly
4. **ci:e2e**: Check that all cypress tests pass *(only if tests are enabled)*. 
   This command must generate the coverage report **lcov.info** inside the **coverage** folder in the NodeJS directory.
   (e.g. `frontend/coverage/lcov.info`)

This workflow uses **npm** as package manager.

###### Workflow
**node-workflow-common.yml** is the reusable workflow to check that the code is correctly formatted and linted, that it
builds correctly and that all tests pass.

It groups together these reusable workflows:
- *node-step-format-lint-build.yml*
- *node-step-test-cypress.yml*

It requires these inputs:
- **NATIVE_CI_LABELS**: the *labels* to select the correct *github-runner* that will execute workflows **WITHOUT** docker. The format is a stringified JSON list of labels.
- **CONTAINER_CI_LABELS**: the *labels* to select the correct *github-runner* that will execute workflows **WITH** docker. The format is a stringified JSON list of labels.
- **WORKING_DIRECTORY**: The directory where the runner can execute all the commands. This is basically the directory which contains the NodeJS application.
- **NODE_VERSION**: The NodeJS Docker image where the runner execute all the commands.
- **CYPRESS_IMAGE**: The Cypress Docker image where the runner execute all the commands.

In addition, it is possible to specify these optional inputs:
- **COVERAGE_ARTIFACT_NAME**: The artifact's name for the *lcov.info* file. By default, it is **lcov.info**.
- **ENABLE_TESTS**: Whether it should skip or not the cypress tests workflow. By default, it is **true**.

This is an example to show how data should be formatted. 
```yaml
jobs:
  node-common:
    uses:
      zupit-it/pipeline-templates/.github/workflows/node-workflow-common.yml@main
    with:
      NATIVE_CI_LABELS: "['pinga', 'pipeline', 'native']"
      CONTAINER_CI_LABELS: "['pinga', 'pipeline', 'container']"
      WORKING_DIRECTORY: frontend
      NODE_VERSION: 16.17.0
      CYPRESS_IMAGE: cypress/browsers:node16.17.0-chrome106
    secrets: inherit
```

---

#### NodeJS build docker image and push to registry

###### Requirements
This workflow requires this command in order to succeed:
1. **build:{environment}**: Build the project based on the target **environment** (e.g. *testing*, *staging* and *production*)

It also requires a **Dockerfile** inside the *working directory* to create the docker image to publish on a docker registry.

This workflow uses **npm** as package manager.

###### Workflow
**node-step-docker-build-and-push-image.yml** is the workflow that builds the docker image and then push it to the registry.
This is a specific version of the *docker-step-build-and-push-image.yml* as this adds the NodeJS build of the project.

*This workflow uses a NodeJS Docker image, hence remember to use labels to match runners specific for Docker.*

It requires these inputs:
- **LABELS**: the *labels* to select the correct *github-runner* that will execute this workflow. The format is a stringified JSON list of labels.
- **NODE_VERSION**: The NodeJS version required to build the project.
- **WORKING_DIRECTORY**: The directory where the runner can execute all the commands.
- **RELEASE_ENVIRONMENT**: The environment for which the project must be compiled (e.g. *testing*, *staging*, *production*).
- **REGISTRY_URL**: The registry url where to push the Docker image.
- **DOCKERFILE_PATH**: The path to the Dockerfile to build.
- **DOCKER_IMAGE_NAME**: The name to assign to the built Docker image.
- **DOCKER_IMAGE_TAG**: The tag to assign to the built Docker image.
- **BUILD_ARGS**: Additional data to pass when building the Dockerfile.

It then outputs this variable:
- **DOCKER_IMAGE_NAME**: The final Docker image name with the registry path included.

This is an example to show how data should be formatted. 
```yaml
jobs:
  build-and-push-image:
    uses: 
      zupit-it/pipeline-templates/.github/workflows/node-step-docker-build-and-push-image.yml@main
    with:
      LABELS: "['pinga', 'pipeline', 'container']"
      NODE_VERSION: 16.17.0
      RELEASE_ENVIRONMENT: testing
      WORKING_DIRECTORY: frontend
      REGISTRY_URL: ghcr.io
      DOCKERFILE_PATH: frontend/docker/Dockerfile
      DOCKER_IMAGE_NAME: ionic
      DOCKER_IMAGE_TAG: latest
      BUILD_ARGS: |
        DIST_PATH=dist/apps/enci
    secrets: inherit
```

---

### Django

#### Django Common
###### Requirements
This workflow requires these files inside the Django directory:
1. **requirements.txt** with **Coverage**, **Black** and **Flake8** to check the coverage and the code style.
2. **env.github** with the required environment variables in order to run the checks and tests in the workflows.

This workflow uses **pip** as package manager.

###### Workflow
**django-workflow-common.yml** is the reusable workflow to check that the code is correctly linted, that all migrations
are not broken and that all tests pass.

It groups together these reusable workflows:
- *django-step-lint-check.yml*
- *django-step-tests.yml*


It requires these inputs:
- **NATIVE_CI_LABELS**: the *labels* to select the correct *github-runner* that will execute workflows **WITHOUT** docker. The format is a stringified JSON list of labels.
- **CONTAINER_CI_LABELS**: the *labels* to select the correct *github-runner* that will execute workflows **WITH** docker. The format is a stringified JSON list of labels.
- **WORKING_DIRECTORY**: The directory where the runner can execute all the commands. This is basically the directory which contains the Django application.
- **PYTHON_IMAGE**: The Python Docker image where the runner execute all the commands.

In addition, it is possible to specify this optional input:
- **COVERAGE_ARTIFACT_NAME**: The artifact's name for the *coverage-django.xml* file. By default, it is **coverage-django.xml**.

This is an example to show how data should be formatted. 
```yaml
jobs:
  django-common:
    uses:
      zupit-it/pipeline-templates/.github/workflows/django-workflow-common.yml@main
    with:
      WORKING_DIRECTORY: backend
      PYTHON_IMAGE: python:3.8.2-slim-buster
      NATIVE_CI_LABELS: "['pinga', 'pipeline', 'native']"
      CONTAINER_CI_LABELS: "['pinga', 'pipeline', 'container']"
      COVERAGE_ARTIFACT_NAME: coverage-django.xml
    secrets: inherit
```

---

### SpringBoot

#### SpringBoot Common
###### Requirements
This workflow requires these plugins:
1. **Spotless** & **Checkstyle** to check that formatting and coding style are correct.
2. **Jacoco** to create report from tests.

In addition, the maven command *Verify* should generate coverage reports.

This workflow uses **maven** as package manager.

###### Workflow
**springboot-workflow-common.yml** is the reusable workflow to check that the code is correctly linted and that all tests pass.

It groups together these reusable workflows:
- *springboot-step-lint-check.yml*
- *springboot-step-tests.yml*

It requires these inputs:
- **NATIVE_CI_LABELS**: the *labels* to select the correct *github-runner* that will execute workflows **WITHOUT** docker. The format is a stringified JSON list of labels.
- **CONTAINER_CI_LABELS**: the *labels* to select the correct *github-runner* that will execute workflows **WITH** docker. The format is a stringified JSON list of labels.
- **WORKING_DIRECTORY**: The directory where the runner can execute all the commands. This is basically the directory which contains the Django application.
- **JAVA_IMAGE**: The Java Docker image where the runner execute all the commands.

In addition, it is possible to specify this optional input:
- **COVERAGE_ARTIFACT_NAME**: The artifact's name for the *jacoco reports* file. By default, it is **target**.
- **MAVEN_USER_HOME**: The path to Maven directory. By default, it is **./m2**.
- **EXTRA_MAVEN_ARGS**: Additional arguments for Maven. By default, it is **""**.
- **USE_CI_POSTGRES**: Whether to use Postgres for tests or not. If enabled, it injects the connection string to the DB for tests. By default, it is **true**.

This is an example to show how data should be formatted. 
```yaml
jobs:
  java-common:
    uses:
      zupit-it/pipeline-templates/.github/workflows/springboot-workflow-common.yml@main
    with:
      NATIVE_CI_LABELS: "['pinga', 'pipeline', 'native']"
      CONTAINER_CI_LABELS: "['pinga', 'pipeline', 'container']"
      WORKING_DIRECTORY: backend
      JAVA_IMAGE: openjdk:12
      USE_CI_POSTGRES: false
    secrets: inherit
```

---

#### SpringBoot build docker image and push to registry

###### Requirements
This workflow requires this plugin:
1. **jib**: Build and publish docker image to the given registry.

This workflow uses **Maven** as package manager.

###### Workflow
**springboot-step-docker-build-and-push-image.yml** is the workflow that builds the docker image and then push it to the registry.

*This workflow uses a Java Docker image, hence remember to use labels to match runners specific for Docker.*

It requires these inputs:
- **LABELS**: the *labels* to select the correct *github-runner* that will execute this workflow. The format is a stringified JSON list of labels.
- **JAVA_IMAGE**: The Java image required to build the project.
- **RELEASE_ENVIRONMENT**: The environment for which the project must be compiled (e.g. *testing*, *staging*, *production*).
- **WORKING_DIRECTORY**: The directory where the runner can execute all the commands.
- **REGISTRY_URL**: The registry url where to push the Docker image.
- **DOCKER_IMAGE_NAME**: The name to assign to the built Docker image.
- **DOCKER_IMAGE_TAG**: The tag to assign to the built Docker image.

In addition, it is possible to specify this optional input:
- **MAVEN_USER_HOME**: The path to Maven directory. By default, it is **./m2**.
- **EXTRA_MAVEN_ARGS**: Additional arguments for Maven. By default, it is **""**.

It then outputs this variable:
- **DOCKER_IMAGE_NAME**: The final Docker image name with the registry path included.

This is an example to show how data should be formatted. 
```yaml
jobs:
  springboot-build-and-push-image:
    needs: [ common ]

    uses:
      zupit-it/pipeline-templates/.github/workflows/springboot-step-docker-build-and-push-image.yml@main
    with:
      LABELS: "['pinga', 'pipeline', 'container']"
      JAVA_IMAGE: openjdk:12
      RELEASE_ENVIRONMENT: testing
      WORKING_DIRECTORY: backend
      REGISTRY_URL: ghcr.io
      DOCKER_IMAGE_NAME: springboot
      DOCKER_IMAGE_TAG: latest
    secrets: inherit
```

---

### Docker

#### Docker build docker image and push to registry
###### Requirements
This workflow requires a **Dockerfile** inside the *working directory* to create the docker image to publish on a docker registry.

The github runner which will execute this workflow should be capable of running docker commands.

###### Workflow
**docker-step-build-and-push-image.yml** is the workflow that builds the Docker image and then push it to the registry.

It requires these inputs:
- **LABELS**: the *labels* to select the correct *github-runner* that will execute this workflow. The format is a stringified JSON list of labels.
- **WORKING_DIRECTORY**: The directory where the runner can execute all the commands.
- **RELEASE_ENVIRONMENT**: The environment for which the project must be compiled (e.g. *testing*, *staging*, *production*).
- **REGISTRY_URL**: The registry url where to push the Docker image.
- **DOCKERFILE_PATH**: The path to the Dockerfile to build.
- **DOCKER_IMAGE_NAME**: The name to assign to the built Docker image.
- **DOCKER_IMAGE_TAG**: The tag to assign to the built Docker image.
- **BUILD_ARGS**: Additional data to pass when building the Dockerfile.

It then outputs these variables:
- **DOCKER_IMAGE_NAME**: The final Docker image name with the registry path included.

This is an example to show how data should be formatted. 
```yaml
jobs:
  build-and-push-image:
    uses: 
      zupit-it/pipeline-templates/.github/workflows/docker-step-build-and-push-image.yml@main
    with:
      LABELS: "['pinga', 'pipeline', 'native']"
      RELEASE_ENVIRONMENT: testing
      WORKING_DIRECTORY: backend
      REGISTRY_URL: ghcr.io
      DOCKERFILE_PATH: backend/docker/Dockerfile
      DOCKER_IMAGE_NAME: django
      DOCKER_IMAGE_TAG: latest
    secrets: inherit
```

---

#### Deploy Docker Compose
###### Requirements
This workflow requires a **docker-compose** file to start all services required from the application to deploy.

###### Workflow
**docker-step-deploy.yml** is the workflow that starts a Docker compose file on the targeted host.

It requires these inputs:
- **LABELS**: the *labels* to select the correct *github-runner* that will execute this workflow. The format is a stringified JSON list of labels.
- **ENVIRONMENT**: The target environment that will show GitHub on the GitHub action page.
- **DEPLOY_URL**: The target environment url that will show GitHub on the GitHub action page. 
- **REGISTRY_URL**: The registry url where to pull the Docker images.
- **PROJECT_NAME**: The name that will be associated to the Docker Compose stack.
- **DOCKER_COMPOSE_PATH**: The path to the docker-compose file to start.
- **IMAGES**: A stringified json object containing as key the environment variables images used in the 
  Docker compose file and as value the name of the images that will be downloaded from the registry.
  You can retrieve dynamically the image name from the *docker build and push step* by adding the step's name to the **needs** array of the workflow 
  and using `${{ needs.{STEP_NAME}.outputs.DOCKER_IMAGE_NAME }}` where STEP_NAME is the step's name. 

This is an example to show how data should be formatted. 
```yaml
jobs:
  deploy:
    uses: 
      zupit-it/pipeline-templates/.github/workflows/docker-step-deploy.yml@main
    with:
      LABELS: "[ 'pinga', 'deploy', 'native', 'zupit-applications' ]"
      ENVIRONMENT: testing
      DEPLOY_URL: https://workflows-example.testing.zupit.software
      REGISTRY_URL: ghcr.io
      PROJECT_NAME: workflows-example
      DOCKER_COMPOSE_PATH: docker/testing/docker-compose.yml
      IMAGES: "{
          'BACKEND_IMAGE_TAG': '${{ needs.backend-step.outputs.DOCKER_IMAGE_NAME }}',
          'FRONTEND_IMAGE_TAG': '${{ needs.frontend-step.outputs.DOCKER_IMAGE_NAME }}'
        }"
    secrets: inherit
```

---

#### Delete Docker Images
**docker-step-delete-images.yml** is the workflow that manage the retention policy on the GitHub Registry. 
It deletes all untagged images and it allows to have a maximum of N tagged images for staging and other N tagged images for production.
This workflow should be scheduled using cron to achieve the retention policy.

The images' tags must follow this naming convention:
- `latest`: for testing environment. This won't be deleted.
- `v[0-9]+.[0-9]+.[0-9]+-rc`: for staging environment.
- `v[0-9]+.[0-9]+.[0-9]+`: for production environment.

It requires these inputs:
- **LABELS**: the *labels* to select the correct *github-runner* that will execute this workflow. The format is a stringified JSON list of labels.
- **IMAGE_NAME**: The image name to apply the retention policy.
- **KEEP_AT_LEAST**: The number of tagged version to maintain for both staging and production environments.

It also requires these secrets:
- **RETENTION_POLICY_TOKEN**: A PAT with permissions to **read:packages** and **delete:packages** 

In addition, it is possible to specify these optional inputs:
- **DRY_RUN**: Only for tagged images, it shows which ones will be deleted without deleting them. By default, it is **false**.

This is an example to show how data should be formatted. 
```yaml
jobs:
  clean-ionic-images:
    uses: 
      ZupitSRL/pipeline-templates/.github/workflows/docker-step-delete-images.yml@main
    with:
      LABELS: "['pinga', 'pipeline', 'native']"
      IMAGE_NAME: 'ionic'
    secrets: inherit
```

---

### Jira

#### Jira Move Issue

###### Workflow
**jira-step-move-issue.yml** is the workflow that moves Jira issues to the desired state.

It requires these inputs:
- **LABELS**: the *labels* to select the correct *github-runner* that will execute this workflow. The format is a stringified JSON list of labels.
- **STATUS**: the final status of the Jira issue.
- **BRANCH_OR_COMMIT_TITLE**: the branch or commit title from where extract the Jira issue key.

It also requires these secrets:
- **JIRA_BASE_URL**: the JIRA url.
- **JIRA_USER_EMAIL**: the JIRA user account email.
- **JIRA_API_TOKEN**: the token to login the Jira user account email.

This is an example to show how data should be formatted. 
```yaml
jobs:
  jira-move-issue-to-developed:
    uses:
      zupit-it/pipeline-templates/.github/workflows/jira-step-move-issue.yml@main
    with:
      LABELS: "['pinga', 'pipeline', 'native']"
      STATUS: Developed
      BRANCH_OR_COMMIT_TITLE: ${{ github.event.workflow_run.head_commit.message }}
    secrets: inherit
```

###### Use Cases Workflows
Here we show 3 use cases that you can copy paste in your project to have the default configuration for transitioning 
Jira issues to these 3 states: *In Progress*, *Merge Request* and *Developed*, without worrying about how to retrieve
the branch or commit title based on the workflow type.

Basically, these workflows starts with these events:
- **Pull Request opened**: Move the Jira issue to *In Progress*.
- **Pull Request review**: Move the Jira issue to *Merge Request* if the PR is not in draft.
- **Pull Request ready for review**: Move the Jira issue to *Merge Request*.
- **On main workflow completion**: Move the Jira issue to *Developed*.

**Move to In Progress** - *jira-move-in-progress.yml*
```yaml
name: Jira Move to In Progress

on:
  pull_request:
    types: [opened]

jobs:
  jira-move-issue-to-in-progress:
    uses:
      zupit-it/pipeline-templates/.github/workflows/jira-step-move-issue.yml@main
    with:
      LABELS: "['pinga', 'pipeline', 'native']"
      STATUS: "In progress"
      BRANCH_OR_COMMIT_TITLE: ${{ github.head_ref }}
    secrets: inherit
```
---
**Move to Merge Request** - *jira-move-merge-request.yml*
```yaml
name: Jira Move to Merge Request

on:
  pull_request:
    types: [review_requested, ready_for_review]

jobs:
  jira-move-issue-to-merge-request:
    if: ${{ !github.event.pull_request.draft }}
    uses:
      zupit-it/pipeline-templates/.github/workflows/jira-step-move-issue.yml@main
    with:
      LABELS: "['pinga', 'pipeline', 'native']"
      STATUS: "Merge request"
      BRANCH_OR_COMMIT_TITLE: ${{ github.head_ref }}
    secrets: inherit
```
---
**Move to Developed** - *jira-move-developed.yml*
```yaml
name: Jira Move to Developed

on:
  workflow_run:
    workflows: [Main Workflow]
    types:
      - completed

jobs:
  jira-move-issue-to-developed:
    uses:
      zupit-it/pipeline-templates/.github/workflows/jira-step-move-issue.yml@main
    with:
      LABELS: "['pinga', 'pipeline', 'native']"
      STATUS: "Developed"
      BRANCH_OR_COMMIT_TITLE: ${{ github.event.workflow_run.head_commit.message }}
    secrets: inherit
```

---

#### Jira Create TODO Issue
###### Workflow
**jira-step-create-todo-issues.yml** is the workflow that creates new Jira issues if it detects any **TODO** comment
in the code. The generated issue can have the desired issue type with a given description together with an input link 
(which should contain the commit diff).

Beware that created tasks are independent, they aren't affected by the changes to the code. Thus, If you modify an existing TODO, 
it will basically create a new task, it won't touch or delete the previous generated task. Same if you delete a TODO, nothing
will happen to the existing task.

It requires these inputs:
- **LABELS**: the *labels* to select the correct *github-runner* that will execute this workflow. The format is a stringified JSON list of labels.
- **PROJECT_KEY**: the key to determine the Jira project.

It also requires these secrets:
- **JIRA_BASE_URL**: the JIRA url.
- **JIRA_USER_EMAIL**: the JIRA user account email.
- **JIRA_API_TOKEN**: the token to login the Jira user account email.

In addition, it is possible to specify these optional inputs:
- **ISSUE_TYPE**: The type of issue to create. By default, it is **Task**.
- **ISSUE_DESCRIPTION**: The description of the issue. By default, it is **Created automatically via GitHub Actions**
- **LINK**: Link to the GitHub page with the commit diff, useful to check when the TODO was added. By default, it is **""**.

This is an example to show how data should be formatted. 
```yaml
jobs:
  jira-create-todo-issue:
    uses:
      zupit-it/pipeline-templates/.github/workflows/jira-step-create-todo-issues.yml@main
    with:
      LABELS: "['pinga', 'pipeline', 'native']"
      PROJECT_KEY: DDSO
      LINK: ${{ github.event.compare }}
    secrets: inherit
```

---

### Others

#### Sonar Analyze
###### Requirements
This workflow requires a **sonar-project.properties** file inside the *working directory* with the configuration for Sonarqube.

###### Workflow
**sonar-step-analyze.yml** is the workflow that analyze the coverage and sends the results to Sonarqube.

It requires these inputs:
- **LABELS**: the *labels* to select the correct *github-runner* that will execute this workflow. The format is a stringified JSON list of labels.
- **WORKING_DIRECTORY**: The directory where the runner can execute all the commands.

It also requires these secrets:
- **SONAR_TOKEN**: The Sonarqube token.

In addition, it is possible to specify these optional inputs:
- **SONAR_IMAGE**: The Sonarqube docker image where the runner execute all commands. By default, it is **sonarsource/sonar-scanner-cli**.
- **SONAR_HOST_URL**: The Sonarqube host to where submit analyzed data. By default, it is **https://sonarqube.zupit.software**
- **DOWNLOAD_ARTIFACT**: Whether it should download an artifact or not to analyze. By default, it is **true**.
- **ARTIFACT_FILENAME**: The name of the artifact. By default, it is an empty string.

This is an example to show how data should be formatted. 
```yaml
jobs:
  angular-sonar-analyze:
    uses: 
      zupit-it/pipeline-templates/.github/workflows/sonar-step-analyze.yml@main
    with:
      WORKING_DIRECTORY: frontend
      ARTIFACT_FILENAME: lcov.info
      LABELS: "['pinga', 'pipeline', 'container']"
    secrets: inherit
```