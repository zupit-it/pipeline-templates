# Zupit Reusable Workflows

This repository contains reusable workflows to check, build, and deploy our projects.

Here we list only the workflows to be referenced externally with some examples of how to implement them.
The reason why we skip some workflows is due to the fact that these are already included inside other workflows
in order to reduce boilerplate when writing the final workflows.
If you would like to get more details of these tasks, just look at this [doc](docs/GROUPED_STEP_WORKFLOWS.md).

1. [Composite Actions](#composite-actions)
    1. [Naming Convention](#actions---naming-convention)
    2. [NodeJS](#nodejs-action)
        1. [Build](#nodejs-action---build)
    3. [Docker](#docker-action)
        1. [Build and Push](#docker-action---build-and-push-docker-image)
    4. [.NET](#net-action)
        1. [Install](#net-action---install)
        2. [Build](#net-action---build)
        3. [Format](#net-action---format)
        4. [Lint](#net-action---lint)
        5. [Test](#net-action---test)
        6. [Publish](#net-action---publish)
        7. [Release](#net-action---release)
    5. [Azure](#azure-action)
        1. [App Service](#azure-action---app-service---deploy)
        2. [Storage Account](#azure-action---storage-account---deploy)
    6. [IIS](#iis-action)
        1. [Deploy](#iis-action---deploy)
    7. [Artifact](#artifact-action)
        1. [Generate name](#artifact-action---generate-name)
        2. [Download](#artifact-action---download)
        3. [Upload](#artifact-action---upload)
        4. [Create archive](#artifact-action---create-archive)
        5. [Extract archive](#artifact-action---extract-archive)
2. [Reusable Workflows](#reusable-workflows)
    1. [Naming Convention](#naming-convention)
    2. [NodeJS](#nodejs---backend--frontend)
        1. [Common NodeJS](#nodejs-common)
        2. [Build Docker Image and Push to Registry](#nodejs-build-docker-image-and-push-to-registry)
        3. [Build and deploy to Azure Storage](#nodejs-build-and-deploy-to-azure-storage)
    3. [Django](#django)
        1. [Common Django](#django-common)
    4. [SpringBoot](#springboot)
        1. [Common SpringBoot](#springboot-common)
        2. [Build Docker Image and Push to Registry](#springboot-build-docker-image-and-push-to-registry)
    5. [.NET](#net)
        1. [Common .NET](#net-common)
    6. [Docker](#docker)
        1. [Build Docker Image and Push to Registry](#docker-build-docker-image-and-push-to-registry)
        2. [Deploy Docker Compose](#deploy-docker-compose)
        3. [Delete Docker Images](#delete-docker-images)
    7. [Jira](#jira)
        1. [Jira Move Issue](#jira-move-issue)
        2. [Jira Create TODO Issue](#jira-create-todo-issue)
    8. [Conventional Commits](#conventional-commits)
        1. [Conventional Commits Lint Step](#conventional-commits-lint-step)
        2. [Conventional Commits Release Step](#conventional-commits-release-step)
    9. [Others](#others)
        1. [Sonar Analyze](#sonar-analyze)
        2. [Sonar Analyze - .NET](#sonar-analyze---net)

## Composite Actions

Composite actions allow to group together a set of steps and use them inside other jobs' steps, reducing the duplicated code in the workflows.
Each composite action must be located in its own folder and the path to this folder will be the way to reference the action externally.

For example, the action of building a NodeJs project is located in the folder **.github/actions/node/build**.
If you need to use this action, you need to append to the repository name the path **.github/actions/node/build**:

`zupit-it/pipeline-templates/.github/actions/node/build`

### Actions - Naming convention

Each composite should be located inside the path

`zupit-it/pipeline-templates/.github/actions/<technology>/<action-to-execute>`

Where:

-   **technology** is the technology used to execute the action. For example, the build of a NodeJS project, **NodeJS** is the technology.
-   **action-to-execute** is the action that you want to execute. In the previous example, **build** is the action.

In this way, all actions for the same technology are grouped together.

Sometimes you could need more than one nesting level because you want to group multiple actions. The only case, as of now, is to group deploy actions by service and by provider.

For example:

-   Azure
    -   App Service
    -   Functions
    -   Storage Accounts
-   AWS
    -   App Runner
    -   Lambda
    -   S3 bucket

### NodeJS Action

#### NodeJS Action - Build

###### Requirements

This workflow requires this command in order to succeed:

1. **build:{environment}**: Build the project based on the target **environment** (e.g. _testing_, _staging_ and _production_)

_This workflow call automatically the action **checkout** to download the codebase._

This workflow uses **npm** as package manager.

###### Action

**.github/actions/node/build** is the action that builds a NodeJS project.

It requires these inputs:

-   **NODE_VERSION**: The NodeJS version required to build the project.
-   **RELEASE_ENVIRONMENT**: The environment for which the project must be compiled (e.g. _testing_, _staging_, _production_).
-   **WORKING_DIRECTORY**: The directory where the runner can execute all the commands.

In addition, it is possible to specify this optional input:

-   **SHELL**: The shell type to use. By default, it is **bash**.
-   **PROJECT**: The project to use when running npm scripts. If set, the executed npm script will be `{PROJECT}:{SCRIPT_NAME}` instead of `{SCRIPT_NAME}`.
-   **CHECKOUT_REF**: The ref of the branch/tag to check out before running the build. See the ref parameter of the [checkout action](https://github.com/actions/checkout). By default, it is `''`.

This is an example to show how data should be formatted.

```yaml
jobs:
    build-and-push-image:
        uses: zupit-it/pipeline-templates/.github/workflows/node-step-docker-build-and-push-image.yml@v1.15.6
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

### Docker Action

#### Docker Action - Build and Push Docker Image

###### Requirements

This workflow requires a **Dockerfile** inside the _working directory_ to create the docker image to publish on a docker registry.

_Before calling this workflow, remember to call the action **checkout** to download the codebase._

This workflow uses **npm** as package manager.

###### Action

**.github/actions/docker/build-and-push** is the composite action that builds the docker image and then push it to the registry.

It requires these inputs:

-   **WORKING_DIRECTORY**: The directory where the runner can execute all the commands.
-   **REGISTRY_URL**: The registry url where to push the Docker image. By default, it is **ghcr.io**.
-   **REGISTRY_USER**: The registry url where to push the Docker image.
    By default, it is the GitHub variable **github.actor**, the user who started the workflow.
-   **REGISTRY_PASSWORD**: The user's password to access the registry.
-   **DOCKERFILE_PATH**: The path to the Dockerfile to build.
-   **DOCKER_IMAGE_NAME**: The name to assign to the built Docker image.
-   **DOCKER_IMAGE_TAG**: The tag to assign to the built Docker image.
-   **BUILD_ARGS**: Additional data to pass when building the Dockerfile.
-   **ENV_VARIABLES**: A stringified json to pass multiple values at once, since Github does not propagate env variables.

It then outputs this variable:

-   **DOCKER_IMAGE_NAME**: The final Docker image name with the registry path included.

This is an example to show how data should be formatted.

```yaml
steps:
    - name: Checkout repository
      uses: actions/checkout@v3

    - name: Build & Push Docker
      id: docker
      uses: zupit-it/pipeline-templates/.github/actions/docker/build-and-push@v1.15.6
      with:
          REGISTRY_URL: ghcr.io
          REGISTRY_USER: ${{ github.actor }}
          REGISTRY_PASSWORD: ${{ github.token }}
          WORKING_DIRECTORY: frontend
          DOCKERFILE_PATH: frontend/docker/Dockerfile
          DOCKER_IMAGE_NAME: angular
          DOCKER_IMAGE_TAG: latest
          BUILD_ARGS: |
              DIST_PATH=dist/testing
      env: "${{secrets}}"
```

---

### .NET Action

#### .NET Action - Install

This action:

-   auto-generate a `global.json`, if not provided;
-   [install .NET SDK dependencies on Alpine OS](https://learn.microsoft.com/en-us/dotnet/core/install/linux-alpine#dependencies);
-   install the specified .NET SDK version. The `dotnet` command becomes globally available.

###### Requirements

-   The `WORKING_DIRECTORY` directory must contain a solution or a project file.

_This workflow doesn't download the codebase. You have to check out the repo by yourself._

###### Action

**.github/actions/dotnet/install** is the action that install .NET in the current runner.

It requires these inputs:

-   **WORKING_DIRECTORY**: The directory where the runner can execute all the commands. It must contain a solution (`.sln`) or a project (`.csproj`) file.
-   **DOTNET_VERSION**: The .NET SDK version to install. See [documentation](https://learn.microsoft.com/en-us/dotnet/core/tools/global-json#version) for allowed values.
-   **ALPINE_OS**: Whatever or not the current Linux distribution is Alpine. This could be auto-detected in the future.

In addition, it is possible to specify this optional input:

-   **SHELL**: The shell type to use. By default, it is **bash**.

This is an example to show how data should be formatted.

```yaml
steps:
    - name: Install .NET
      uses: zupit-it/pipeline-templates/.github/actions/dotnet/install@v1.15.6
      with:
          WORKING_DIRECTORY: "back-end"
          DOTNET_VERSION: "7"
          ALPINE_OS: true
          SHELL: "bash"
```

#### .NET Action - Build

This action:

-   download NuGet packages from the cache, if available;
-   restore NuGet packages;
-   run the `dotnet build` command on the `WORKING_DIRECTORY`.

###### Requirements

-   The `WORKING_DIRECTORY` directory must contain a solution or a project file.
-   A `packages.lock.json` file must be provided for the solution in order to enable [repeatable package restoration](https://github.com/NuGet/Home/wiki/Enable-repeatable-package-restore-using-lock-file).
-   The correct .NET version must be installed.

_This workflow doesn't download the codebase. You have to check out the repo by yourself._

###### Action

**.github/actions/dotnet/build** is the action that builds a .NET project or solution.

It requires these inputs:

-   **WORKING_DIRECTORY**: The directory where the runner can execute all the commands. It must contain a solution (`.sln`) or a project (`.csproj`) file.
-   **BUILD_CONFIG**: The configuration to use when building the solution or the project. Usually `Debug` or `Release`.

In addition, it is possible to specify this optional input:

-   **SHELL**: The shell type to use. By default, it is **bash**.

This is an example to show how data should be formatted.

```yaml
steps:
    - name: Build
      uses: zupit-it/pipeline-templates/.github/actions/dotnet/build@v1.15.6
      with:
          WORKING_DIRECTORY: "back-end"
          BUILD_CONFIG: "Release"
          SHELL: "bash"
```

#### .NET Action - Format

This action:

-   install or update [CSharpier](https://csharpier.com/);
-   run the `dotnet-csharpier . --check` command on the `WORKING_DIRECTORY`.

###### Requirements

-   The `WORKING_DIRECTORY` directory must contain a solution or a project file.
-   The correct .NET version must be installed.

_This workflow doesn't download the codebase. You have to check out the repo by yourself._

###### Action

**.github/actions/dotnet/format** is the action that checks the code formatting of a .NET solution.

It requires these inputs:

-   **WORKING_DIRECTORY**: The directory where the runner can execute all the commands. It must contain a solution (`.sln`) or a project (`.csproj`) file.

In addition, it is possible to specify this optional input:

-   **SHELL**: The shell type to use. By default, it is **bash**.
-   **CSHARPIER_VERSION**: The [CSharpier version](https://github.com/belav/csharpier/releases) to install. By default, it is the latest.

This is an example to show how data should be formatted.

```yaml
steps:
    - name: Build
      uses: zupit-it/pipeline-templates/.github/actions/dotnet/format@v1.15.6
      with:
          WORKING_DIRECTORY: "back-end"
          SHELL: "bash"
          CSHARPIER_VERSION: "0.25.0"
```

#### .NET Action - Lint

This action:
-   run the `dotnet format` command on the `WORKING_DIRECTORY`.

###### Requirements

-   The `WORKING_DIRECTORY` directory must contain a solution or a project file.
-   The correct .NET (6+) version must be installed.

_This workflow doesn't download the codebase. You have to check out the repo by yourself._

###### Action

**.github/actions/dotnet/lint** is the action that lints the code of a .NET solution.

It requires these inputs:

-   **WORKING_DIRECTORY**: The directory where the runner can execute all the commands. It must contain a solution (`.sln`) or a project (`.csproj`) file.

In addition, it is possible to specify this optional input:

-   **SHELL**: The shell type to use. By default, it is **bash**.

This is an example to show how data should be formatted.

```yaml
steps:
    - name: Build
      uses: zupit-it/pipeline-templates/.github/actions/dotnet/lint@v1.15.6
      with:
          WORKING_DIRECTORY: "backend"
          SHELL: "bash"
```

#### .NET Action - Test

This action:

-   discovers and executes tests on the .NET solution contained in the `WORKING_DIRECTORY` directory;
-   if specified, it generates tests and code coverage results.

###### Requirements

-   The `WORKING_DIRECTORY` directory must contain a solution or a project file.
-   The correct .NET version must be installed.
-   The project must be already built.

_This workflow doesn't download the codebase. You have to check out the repo by yourself._

###### Action

**.github/actions/dotnet/test** is the action that tests a .NET solution.

It requires these inputs:

-   **WORKING_DIRECTORY**: The directory where the runner can execute all the commands. It must contain a solution (`.sln`) or a project (`.csproj`) file.

In addition, it is possible to specify this optional input:

-   **GENERATE_CODE_COVERAGE**: Whatever or not the test results and code coverage files should be generated. If `true`, a `TestResults` folder containing `.trx` test results and a `coverage.opencover.xml` cover file are generated inside each test project folder. By default, it is **true**.
-   **SHELL**: The shell type to use. By default, it is **bash**.

This is an example to show how data should be formatted.

```yaml
steps:
    - name: Run tests
      uses: zupit-it/pipeline-templates/.github/actions/dotnet/test@v1.15.6
      with:
          WORKING_DIRECTORY: "back-end"
          GENERATE_CODE_COVERAGE: true
```

---

#### .NET Action - Publish

This action run the [dotnet publish](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-publish) command on the `WORKING_DIRECTORY` directory.

###### Requirements

-   The `WORKING_DIRECTORY` directory must be an ancestor of the project file (`PROJECT` parameter).
-   The correct .NET version must be installed.
-   The project must be already built.

_This workflow doesn't download the codebase. You have to check out the repo by yourself._

###### Action

**.github/actions/dotnet/publish** is the action that publishes a .NET project.

It requires these inputs:

-   **WORKING_DIRECTORY**: The ancestor directory of the project.
-   **BUILD_CONFIG**: The configuration to use when publishing the project. Usually `Release`.
-   **PROJECT**: The path to the `.csproj` file, relative to the `WORKING_DIRECTORY` directory.
-   **OUTPUT_DIRECTORY**: The directory where output binaries will be created. This is relative to the `WORKING_DIRECTORY` directory.

In addition, it is possible to specify this optional input:

-   **SHELL**: The shell type to use. By default, it is **bash**.

This is an example to show how data should be formatted.

```yaml
steps:
    - name: Install .NET
      uses: zupit-it/pipeline-templates/.github/actions/dotnet/install@v1.15.6
      with:
          WORKING_DIRECTORY: "back-end"
          PROJECT: "My.Api/My.Api.csproj"
          OUTPUT_DIRECTORY: "binaries"
          BUILD_CONFIG: "Release"
          SHELL: "bash"
```

#### .NET Action - Release

This action executes the following child-actions:

-   [.NET Build](#net-action---build)
-   [.NET Publish](#net-action---publish)

It's a convenience action for repeated actions used together for most of the time.

###### Requirements

Check the requirements of the child actions:

-   [.NET Build requirements](#net-action---build)
-   [.NET Publish requirements](#net-action---publish)

_This workflow doesn't download the codebase. You have to check out the repo by yourself._

###### Action

**.github/actions/dotnet/release** is the action that installs .NET, builds and publishes a .NET project.

It requires these inputs:

-   **WORKING_DIRECTORY**
-   **BUILD_CONFIG**
-   **PROJECT**
-   **OUTPUT_DIRECTORY**

In addition, it is possible to specify this optional input:

-   **SHELL**: The shell type to use. By default, it is **bash**.

Each parameter is passed down to the homonym parameter of child actions (if available). Check out child actions' parameters definition.

This is an example to show how data should be formatted.

```yaml
steps:
    - name: Build
      uses: zupit-it/pipeline-templates/.github/actions/dotnet/release@v1.15.6
      with:
          WORKING_DIRECTORY: "back-end"
          BUILD_CONFIG: "Release"
          PROJECT: "My.Api/My.Api.csproj"
          OUTPUT_DIRECTORY: "binaries"
```

### Azure Action

#### Azure Action - App Service - Deploy

This action:

-   logs in to Azure CLI;
-   deploy an application to an Azure App Service or Azure Function instance.
-   logs out from Azure CLI.

**Note**: [Azure Functions are built on top of Azure App Service infrastructure](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/service/app-service), reason for which this action is named just _App Service_.

###### Requirements

-   The `WORKING_DIRECTORY` directory must be an ancestor of the `BINARIES_DIRECTORY` directory.
-   The App Service/Function must be correctly configured with the correct technology and runtime version.
-   This action must run in an environment with the Azure CLI installed.
-   This action must run in an environment without any other action performing AZ login/logout in parallel.
-   Bash

###### Action

**.github/actions/azure/app-service/deploy** is the action that deploys an application to an Azure App Service or Azure Function instance.

It requires these inputs:

-   **WORKING_DIRECTORY**: The ancestor directory of the `BINARIES_DIRECTORY` directory.
-   **BINARIES_DIRECTORY**: The folder containing binaries to publish to the App Service/Function.
-   **WEBAPP_NAME**: The name of the AppService/Function.

It also requires these secrets:

-   **AZURE_CREDENTIALS**: The secret json containing credentials to connect using Azure CLI. See the [documentation](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure) for more information.

In addition, it is possible to specify this optional input:

-   **WEBAPP_SLOT**: The App Service/Function slot where the binaries should be published to. By default, it is **production**.

**Note:** this action restarts the App Service/Function.

**Note:** after this action completes it is not guaranteed that the App Service/Function will immediately run the new code. It may require some time based on the technology and hosting (e.g. App Service on Linux).

This is an example to show how data should be formatted.

```yaml
steps:
    - name: Publish to Azure App Service
      uses: zupit-it/pipeline-templates/.github/actions/azure/app-service/deploy@v1.15.6
      with:
          WORKING_DIRECTORY: "back-end"
          BINARIES_DIRECTORY: "output"
          AZURE_CREDENTIALS: ${{ secrets.CI_AZURE_CREDENTIALS }}
          WEBAPP_NAME: "my-app-001"
```

#### Azure Action - Storage Account - Deploy

This action:

-   logs in to Azure CLI;
-   deploy a static web-app to Azure Storage Blob Service.
-   [optional] cleans the Azure CDN or Azure Front-door cache.
-   logs out from Azure CLI.

###### Requirements

-   The `WORKING_DIRECTORY` directory must be an ancestor of the `BINARIES_DIRECTORY` directory.
-   The Storage Account must be configured to [serve static content](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blob-static-website).
-   This action must run in an environment with the Azure CLI installed.
-   This action must run in an environment without any other action performing AZ login/logout in parallel.
-   Bash

###### Action

**.github/actions/azure/storage/deploy** is the action that deploys a static web-app to an Azure Storage Account. It also cleans the cache of the Azure CDN or Azure Front-door if specified.

It requires these inputs:
-   **WORKING_DIRECTORY**: The ancestor directory of the `BINARIES_DIRECTORY` directory.
-   **BINARIES_DIRECTORY**: The folder containing binaries to publish to the Storage Account.
-   **STORAGE_ACCOUNT_NAME**: The name of the Storage Account.

In addition, it is possible to specify this optional input:
-   **CDN_PROFILE_NAME**: Name of the Azure CDN profile name. Required if `CDN_RG_NAME` is specified.
-   **CDN_ENDPOINT_NAME**: Name of the Azure CDN endpoint name. It must be a child of the `CDN_PROFILE_NAME` CDN profile. Required if `CDN_RG_NAME` is specified.
-   **CDN_RG_NAME**: Resource group name where the Azure CDN profile is hold.
-   **FD_ENDPOINT_NAME**: Name of the Azure Front-door endpoint name. Required if `FD_RG_NAME` is specified.
-   **FD_DOMAIN_NAME**: Domain name of the Azure Front-door endpoint. It must be a child of the `FD_ENDPOINT_NAME` Front-door endpoint. Required if `FD_RG_NAME` is specified.
-   **FD_PROFILE_NAME**: Name of the Azure Front-door profile name. Required if `FD_RG_NAME` is specified.
-   **FD_RG_NAME**: Resource group name where the Front-door instance is hold.

If no Front-door or CDN is specified, the action will only upload the files to the Storage Account.

If you want to purge the CDN cache, you must specify:
-   **CDN_PROFILE_NAME**
-   **CDN_ENDPOINT_NAME**
-   **CDN_RG_NAME**

If you want to purge the Front-door cache, you must specify:
-  **FD_ENDPOINT_NAME**
-  **FD_DOMAIN_NAME**
-  **FD_PROFILE_NAME**
-  **FD_RG_NAME**

It also requires these secrets:
-   **AZURE_CREDENTIALS**: The secret json containing credentials to connect using Azure CLI. See the [documentation](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure) for more information.

This is an example to show how data should be formatted.

```yaml
steps:
    - name: Deploy to Azure Storage
      uses: zupit-it/pipeline-templates/.github/actions/azure/storage/deploy@v1.15.6
      with:
          WORKING_DIRECTORY: front-end
          BINARIES_DIRECTORY: dist/apps/my-app
          AZURE_CREDENTIALS: ${{ secrets.CI_AZURE_CREDENTIALS }}
          STORAGE_ACCOUNT_NAME: stmyproject001
          CDN_PROFILE_NAME: cdnp-myproject-001
          CDN_ENDPOINT_NAME: cdne-myproject-001
          CDN_RG_NAME: rg-myproject-001
```

### IIS Action

#### IIS Action - Deploy

This action:

-   deploy an application to IIS.

###### Requirements

-   IIS 6
-   The account used to run the GitHub runner must be part of the `Administrators` group.
-   The application pool must have the same name as the folder of the application.
-   The entrypoint for the IIS website must be located inside the application's folder, and it must be named `htdocs`.

**Example**

-   Application pool name: `example.zupit.software`
-   Application folder: `C:\inetpub\example.zupit.software`
-   IIS website entrypoint: `C:\inetpub\example.zupit.software\htdocs`

###### Action

**.github/actions/iis/deploy** is the action that deploys an application to IIS.

It requires these inputs:

-   **ARTIFACT_NAME**: The artifact's name holding the application's binaries.
-   **APPS_PATH**: The folder path where IIS websites are hosted. This must be the parent of the application's folder.
-   **APP_POOL_NAME**: The name of the application pool.

This is an example to show how data should be formatted.

```yaml
steps:
    - name: Deploy to IIS
      uses: zupit-it/pipeline-templates/.github/actions/iis/deploy@v1.15.6
      with:
          ARTIFACT_NAME: my-artifact-name
          APPS_PATH: 'C:\inetpub'
          APP_POOL_NAME: "example.zupit.software"
```

### Artifact Action

#### Artifact Action - Generate name

This action:
- generates a unique name for an artifact using the specified prefix

The generated artifact name is in the format `prefix-<random-string>`.

###### Requirements
- Bash

###### Action

**.github/actions/artifact/generate-name** is the action that generates a unique name for an artifact using the specified prefix. This is useful when you have multiple artifacts to upload on the same workflow, and you want to avoid name collisions.

It requires these inputs:
-   **NAME_PREFIX**: The prefix to use when generating the artifact name.

It then outputs this variable:
-   **ARTIFACT_NAME**: The generated artifact name.

This is an example to show how to use this action with the support of the **Generate artifact name** action.

```yaml
  - name: Generate artifact name
    id: artifact-name
    uses: zupit-it/pipeline-templates/.github/actions/artifact/generate-name@v1.15.6
    with:
        NAME_PREFIX: dotnet-build

  - name: Build
    uses: zupit-it/pipeline-templates/.github/actions/dotnet/release@v1.15.6
    with:
        WORKING_DIRECTORY: ${{ inputs.WORKING_DIRECTORY }}
        BUILD_CONFIG: "Release"
        PROJECT: my-project
        OUTPUT_DIRECTORY: ${{ steps.artifact-name.outputs.ARTIFACT_NAME }}

  - name: Upload build artifact
    uses: zupit-it/pipeline-templates/.github/actions/artifact/upload@v1.15.6
    with:
        SOURCE_FOLDER: my-source-folder
        ARTIFACT_NAME: ${{ steps.artifact-name.outputs.ARTIFACT_NAME }}
```

#### Artifact Action - Download

This action:
- downloads an archived artifact.
- extracts the artifact in the specified directory.

###### Requirements
- See the requirements of [Artifact Action - Extract archive](#artifact-action---extract-archive).

###### Action

**.github/actions/artifact/download** is the action that downloads an artifact and extracts the archive it holds in the specified directory.

It requires these inputs:
-   **ARTIFACT_NAME**: The artifact's name. Usually, it is the name generated using the action **artifact/generate-name**.

In addition, it is possible to specify this optional input:
-   **OUTPUT_FOLDER**: The folder where the artifact will be extracted. By default, it is **/tmp**.
-   **ARCHIVE_NAME**: The name of the archive hold in the artifact. By default, it is **dist.tar.gz**.

This is an example to show how data should be formatted.

```yaml
steps:
    - name: Download artifact
      uses: zupit-it/pipeline-templates/.github/actions/artifact/download@v1.15.6
      with:
          ARTIFACT_NAME: my-artifact-name
```

#### Artifact Action - Upload

This action:
- creates an archive containing the files in the specified folder and uploads it as an artifact.

###### Requirements
- See the requirements of [Artifact Action - Create archive](#artifact-action---create-archive).

###### Action

**.github/actions/artifact/upload** is the action that creates an archive containing the files in the specified folder and uploads it as an artifact.

It requires these inputs:
- **SOURCE_FOLDER**: The folder containing the files to archive and upload.
- **ARTIFACT_NAME**: The name of the artifact to create.

In addition, it is possible to specify this optional input:
- **ARCHIVE_PATH**: The path to the archive to create. By default, it is **/tmp/dist.tar.gz**.
- **RETENTION_DAYS**: The number of days to keep the artifact. By default, it is **1**.

This is an example to show how to use this action with the support of the **Generate artifact name** action.

```yaml
  - name: Generate artifact name
    id: artifact-name
    uses: zupit-it/pipeline-templates/.github/actions/artifact/generate-name@v1.15.6
    with:
        NAME_PREFIX: dotnet-build

  - name: Build
    uses: zupit-it/pipeline-templates/.github/actions/dotnet/release@v1.15.6
    with:
        WORKING_DIRECTORY: my-dir
        BUILD_CONFIG: "Release"
        PROJECT: my-project
        OUTPUT_DIRECTORY: ${{ steps.artifact-name.outputs.ARTIFACT_NAME }}

  - name: Upload build artifact
    uses: zupit-it/pipeline-templates/.github/actions/artifact/upload@v1.15.6
    with:
        SOURCE_FOLDER: my-source-folder
        ARTIFACT_NAME: ${{ steps.artifact-name.outputs.ARTIFACT_NAME }}
```

#### Artifact Action - Create archive

This action:
- creates an archive containing the files in the specified folder.

###### Requirements
- Bash
- OS: Linux or Windows 10 Build 17063 and more recent. The action is based on the `tar` command.

###### Action

**.github/actions/artifact/create-archive** is the action that creates an archive containing the files in the specified folder.

It requires these inputs:
  - **SOURCE_FOLDER**: The folder containing the files to archive.

In addition, it is possible to specify this optional input:
  - **ARCHIVE_PATH**: The path to the archive to create. By default, it is **/tmp/dist.tar.gz**.


It then outputs this variable:
- **ARCHIVE_PATH**: The path to the archive created.

You may want to use the [Artifact Action - Upload](#artifact-action---upload) instead of this action, as it creates an archive and uploads it as an artifact.

This is an example to show how data should be formatted.
```yaml
    - name: Create archive
      uses: zupit-it/pipeline-templates/.github/actions/artifact/create-archive@v1.15.6
      with:
          SOURCE_FOLDER: my-source-folder
          ARCHIVE_NAME: my-archive
```

#### Artifact Action - Extract archive

This action:
- extracts an archive in the specified directory.

###### Requirements
- Bash
- OS: Linux or Windows 10 Build 17063 and more recent. The action is based on the `tar` command.

###### Action

**.github/actions/artifact/extract-archive** is the action that extracts an archive in the specified directory.

It requires these inputs:
- **ARCHIVE_PATH**: The path to the archive to extract.
- **OUTPUT_FOLDER**: The folder where the archive will be extracted.

You may want to use the [Artifact Action - Download](#artifact-action---download) instead of this action, as it downloads an archived artifact and extracts it in the specified directory.

This is an example to show how data should be formatted.
```yaml
    - name: Extract archive
      uses: zupit-it/pipeline-templates/.github/actions/artifact/extract-archive@v1.15.6
      with:
          ARCHIVE_PATH: /tmp/my-archive.tar.gz
          OUTPUT_FOLDER: my-output-folder
```

## Reusable Workflows

In all the examples, we set _secrets: inherit_ to pass all secrets to the reusable workflows, but it is also possible to pass only a subset of secrets.

In addition, we added for all _step_ workflows the input _LABELS_ as GitHub does not allow to set the _runs-on_ from the caller side, but only inside
the reusable workflows. As we want to define the runners as late as possible, we decided to add this input variable.

In the _workflow_ type, you will note that we defined 2 inputs for the labels: NATIVE_LABELS and CONTAINER_LABELS.
We had to differentiate as GitHub runners might start to raise permissions errors due to Docker being run as root.
To fix this problem, workflows using docker images must use different runners from workflows running commands directly on the host.

### Naming convention

We've defined 2 different types of workflows:

-   **step**: a _reusable workflow_ that _runs a set of specific tasks_ that can be grouped together
    (e.g. checking if the project is linted and builds, run the tests, build and push a docker image, ...).
-   **workflow**: a _reusable workflow_ that _contains a set of our "steps" workflows_ to reduce the boilerplate when writing the final workflows.
    One of the use cases is to check if the code is linted, it builds correctly and the tests pass, as this is used in almost all of our projects.

Our reusable workflows are named to follow this standard:

`<technology-or-application>-<workflow-type>-<action-to-execute>.yml`

Thus, it is easy to understand that the workflows uses a specific technology or application to execute the desired action.

### NodeJS - Backend & Frontend

> The following workflows are deprecated:
>
> -   node-step-docker-build-and-push-image.yml
> -   node-step-format-lint-build.yml
> -   node-workflow-common.yml

#### NodeJS Common

###### Requirements

This workflow requires these commands in order to succeed:

1. **[PROJECT:]ci:format:check**: Check that the code is formatted correctly.
2. **[PROJECT:]ci:lint**: Check that the code is linted correctly.
3. **[PROJECT:]ci:build**: Check that the project builds correctly
4. **[PROJECT:]ci:e2e**: Check that all cypress tests pass _(only if tests are enabled)_.
   This command must generate the coverage report **lcov.info** inside the **coverage** folder in the NodeJS directory.
   (e.g. `frontend/coverage/lcov.info`)

The **optional** `PROJECT` value is used in configurations where a single Node solution hosts multiple projects. This is the case for NX, where multiple applications and libraries exist in the same Node project.

This workflow uses **npm** as package manager.

###### Workflow

**node-workflow-common.yml** is the reusable workflow to check that the code is correctly formatted and linted, that it
builds correctly and that all tests pass.

It groups together these reusable workflows:

-   _node-step-format-lint-build.yml_
-   _node-step-test-cypress.yml_

It requires these inputs:

-   **NATIVE_CI_LABELS**: the _labels_ to select the correct _github-runner_ that will execute workflows **WITHOUT** docker. The format is a stringified JSON list of labels.
-   **CONTAINER_CI_LABELS**: the _labels_ to select the correct _github-runner_ that will execute workflows **WITH** docker. The format is a stringified JSON list of labels.
-   **WORKING_DIRECTORY**: The directory where the runner can execute all the commands. This is basically the directory which contains the NodeJS application.
-   **NODE_VERSION**: The NodeJS Docker image where the runner execute all the commands.
-   **CYPRESS_IMAGE**: The Cypress Docker image where the runner execute all the commands.
-   **DIST_PATH**: The output distribution path of the node build

In addition, it is possible to specify these optional inputs:

-   **COVERAGE_ARTIFACT_NAME**: The artifact's name for the _lcov.info_ file. By default, it is **lcov.info**.
-   **ENABLE_TESTS**: Whether it should skip or not the cypress tests workflow. By default, it is **true**.
-   **TIMEOUT**: Used for tests, if the tests take more than the given time in minutes, Github stops forcefully the workflow. By default, it is **30**.
-   **RUN**: Whether to run all the inside workflows or not. This is useful when you want to skip checks since the code didn't change. By default, it is **true**.
-   **PROJECT**: The project to use when running npm scripts. If set, the executed npm script will be `{PROJECT}:{SCRIPT_NAME}` instead of `{SCRIPT_NAME}`.

This is an example to show how data should be formatted.

```yaml
jobs:
    node-common:
        uses: zupit-it/pipeline-templates/.github/workflows/node-workflow-common.yml@v1.15.6
        with:
            NATIVE_CI_LABELS: "['pinga', 'pipeline', 'native']"
            CONTAINER_CI_LABELS: "['pinga', 'pipeline', 'container']"
            WORKING_DIRECTORY: frontend
            NODE_VERSION: 16.17.0
            CYPRESS_IMAGE: cypress/browsers:node16.17.0-chrome106
        secrets: inherit
```

##### Run Optimization

This workflow allows to skip the inner jobs using the input variable **RUN**.
This is useful when the code didn't change, and you want to skip the required checks and allow the PR to move on.
One way to check whether the code changed or not is by using the **dorny/paths-filter@v2** action.
Here is an example of how to know if the code changed and based from that, run or not the workflows.

```yaml
jobs:
    check-changes:
        runs-on: [pinga, pipeline, native]

        outputs:
            backend: ${{ steps.changes.outputs.backend }}
            frontend: ${{ steps.changes.outputs.frontend }}

        steps:
            - uses: dorny/paths-filter@v2
              id: changes
              with:
                  filters: |
                      backend:
                        - 'backend/**'
                      frontend:
                        - 'frontend/**'

    angular-common:
        needs: check-changes
        uses: zupit-it/pipeline-templates/.github/workflows/node-workflow-common.yml@v1.15.6
        with:
            WORKING_DIRECTORY: "frontend"
            NODE_VERSION: "14.11.0"
            NATIVE_CI_LABELS: "['pinga', 'pipeline', 'native']"
            CONTAINER_CI_LABELS: "['pinga', 'pipeline', 'container']"
            ENABLE_TESTS: false
            RUN: ${{ needs.check-changes.outputs.frontend == 'true' }}
        secrets: inherit
```

This basically checks if the 2 folders: **backend** and **frontend**, were touched or not.
If there are any change in the **frontend** folder, then execute all inner workflows inside **node-workflow-common**.

---

#### NodeJS build docker image and push to registry

###### Requirements

This workflow requires this command in order to succeed:

1. **build:{environment}**: Build the project based on the target **environment** (e.g. _testing_, _staging_ and _production_)

It also requires a **Dockerfile** inside the _working directory_ to create the docker image to publish on a docker registry.

This workflow uses **npm** as package manager.

###### Workflow

**node-step-docker-build-and-push-image.yml** is the workflow that builds the docker image and then push it to the registry.
This is a similar version of the _docker-step-build-and-push-image.yml_ as this adds the NodeJS build of the project.

This workflow uses these composite actions:

-   **actions/node/build**: builds NodeJS project
-   **actions/docker/build-and-push**: creates the Docker image and pushes it to the desired registry.

_This workflow uses a NodeJS Docker image, hence remember to use labels to match runners specific for Docker._

It requires these inputs:

-   **NATIVE_CI_LABELS**: the _labels_ to select the correct _github-runner_ that will execute workflows **WITHOUT** docker. The format is a stringified JSON list of labels.
-   **CONTAINER_CI_LABELS**: the _labels_ to select the correct _github-runner_ that will execute workflows **WITH** docker. The format is a stringified JSON list of labels.
-   **NODE_VERSION**: The NodeJS version required to build the project.
-   **WORKING_DIRECTORY**: The directory where the runner can execute all the commands.
-   **RELEASE_ENVIRONMENT**: The environment for which the project must be compiled (e.g. _testing_, _staging_, _production_).
-   **DOCKERFILE_PATH**: The path to the Dockerfile to build.
-   **DOCKER_IMAGE_NAME**: The name to assign to the built Docker image.
-   **DOCKER_IMAGE_TAG**: The tag to assign to the built Docker image.
-   **BUILD_ARGS**: Additional data to pass when building the Dockerfile.
-   **DIST_PATH**: The output distribution path of the node build
-   **ARTIFACT_NAME**: The name of the artifact. Should be changed when using multiple node builds for the same project at the same time

In addition, it is possible to specify these optional inputs:

-   **REGISTRY_URL**: The registry url where to push the Docker image. By default, it is **ghcr.io**.
-   **REGISTRY_USER**: The registry url where to push the Docker image.
    By default, it is the GitHub variable **github.actor**, the user who started the workflow. If you need a different user, remember to override the **GITHUB_TOKEN** secret.
-   **PROJECT**: The project to use when running npm scripts. If set, the executed npm script will be `{PROJECT}:{SCRIPT_NAME}` instead of `{SCRIPT_NAME}`.
-   **CHECKOUT_REF**: The ref of the branch/tag to check out before running the build. See the ref parameter of the [checkout action](https://github.com/actions/checkout). By default, it is `''`.

It then outputs this variable:

-   **DOCKER_IMAGE_NAME**: The final Docker image name with the registry path included.

This is an example to show how data should be formatted.

```yaml
jobs:
    build-and-push-image:
        uses: zupit-it/pipeline-templates/.github/workflows/node-step-docker-build-and-push-image.yml@v1.15.6
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

#### NodeJS build and deploy to Azure Storage

This workflow combines two main actions:

-   [Node.js Build](#nodejs-action---build)
-   [Azure Storage Account](#azure-action---storage-account---deploy)

The input parameters of this workflow have the same name of the corresponding parameters in child actions. Refer to them for more information.

Also, these input parameters are optional:
- **IMAGE**: the docker image to use when running the node build. By default, it is **ubuntu:23.04**.
- **AZURE_CLI_IMAGE**: the docker image to use when running the deployment to Azure Storage. By default, it is **mcr.microsoft.com/azure-cli:2.50.0**.

This is an example to show how data should be formatted.

```yaml
jobs:
    build-and-push-image:
        uses: zupit-it/pipeline-templates/.github/workflows/node-step-azure-storage-build-and-deploy.yml@v1.15.6
        with:
            CONTAINER_CI_LABELS: "['my-team', 'pipeline', 'container']"
            WORKING_DIRECTORY: front-end
            NODE_VERSION: "16.17.0"
            RELEASE_ENVIRONMENT: testing
            DIST_PATH: dist/apps/cta-conta
            STORAGE_ACCOUNT_NAME: stmyproject001
            CDN_PROFILE_NAME: cdnp-myproject-001
            CDN_ENDPOINT_NAME: cdne-myproject-001
            CDN_RG_NAME: rg-myproject-001
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

-   _django-step-lint-check.yml_
-   _django-step-tests.yml_

It requires these inputs:

-   **NATIVE_CI_LABELS**: the _labels_ to select the correct _github-runner_ that will execute workflows **WITHOUT** docker. The format is a stringified JSON list of labels.
-   **CONTAINER_CI_LABELS**: the _labels_ to select the correct _github-runner_ that will execute workflows **WITH** docker. The format is a stringified JSON list of labels.
-   **WORKING_DIRECTORY**: The directory where the runner can execute all the commands. This is basically the directory which contains the Django application.
-   **PYTHON_IMAGE**: The Python Docker image where the runner execute all the commands.

In addition, it is possible to specify this optional input:

-   **COVERAGE_ARTIFACT_NAME**: The artifact's name for the _coverage-django.xml_ file. By default, it is **coverage-django.xml**.
-   **RUN**: Whether to run all the inside workflows or not. This is useful when you want to skip checks since the code didn't change. By default, it is **true**.
-   **DJANGO_MIGRATIONS_CHECK_APPS**: The Django apps on which to run migration checks.
-   **SETUP_COMMANDS**: Allow to execute commands before the download of the dependencies. Useful to install packages required for Python dependencies.
-   **ENABLE_LFS**: To enable Git LFS support on checkout  
-   **LFS_REPO_PATH**: Required when ENABLE_LFS is true. Workaround for https://github.com/actions/checkout/issues/1169. Set to "/__w/repo-name/repo-name" 
-   **COVERAGE_THRESHOLD**: The minimal code coverage for this project. If the coverage is lower than this value, the workflow will fail. By default, it is **50**.

This is an example to show how data should be formatted.

```yaml
jobs:
    django-common:
        uses: zupit-it/pipeline-templates/.github/workflows/django-workflow-common.yml@v1.15.6
        with:
            WORKING_DIRECTORY: backend
            PYTHON_IMAGE: python:3.8.2-slim-buster
            NATIVE_CI_LABELS: "['pinga', 'pipeline', 'native']"
            CONTAINER_CI_LABELS: "['pinga', 'pipeline', 'container']"
            COVERAGE_ARTIFACT_NAME: coverage-django.xml
            SETUP_COMMANDS: "apt update && apt install -y gcc"
        secrets: inherit
```

##### Run Optimization

This workflow allows to skip the inner jobs using the input variable **RUN**.
This is useful when the code didn't change, and you want to skip the required checks and allow the PR to move on.
One way to check whether the code changed or not is by using the **dorny/paths-filter@v2** action.
Here is an example of how to know if the code changed and based from that, run or not the workflows.

```yaml
jobs:
    check-changes:
        runs-on: [pinga, pipeline, native]

        outputs:
            backend: ${{ steps.changes.outputs.backend }}
            frontend: ${{ steps.changes.outputs.frontend }}

        steps:
            - uses: dorny/paths-filter@v2
              id: changes
              with:
                  filters: |
                      backend:
                        - 'backend/**'
                      frontend:
                        - 'frontend/**'

    django-common:
        needs: check-changes
        uses: zupit-it/pipeline-templates/.github/workflows/django-workflow-common.yml@v1.15.6
        with:
            WORKING_DIRECTORY: "backend"
            PYTHON_IMAGE: "python:3.8.2-slim-buster"
            NATIVE_CI_LABELS: "['pinga', 'pipeline', 'native']"
            CONTAINER_CI_LABELS: "['pinga', 'pipeline', 'container']"
            RUN: ${{ needs.check-changes.outputs.backend == 'true' }}
        secrets: inherit
```

This basically checks if the 2 folders: **backend** and **frontend**, were touched or not.
If there are any change in the **backend** folder, then execute all inner workflows inside **django-workflow-common**.

---

### SpringBoot

#### SpringBoot Common

###### Requirements

This workflow requires these plugins:

1. **Spotless** & **Checkstyle** to check that formatting and coding style are correct.
2. **Jacoco** to create report from tests.

In addition, the maven command _Verify_ should generate coverage reports.

This workflow uses **maven** as package manager.

###### Workflow

**springboot-workflow-common.yml** is the reusable workflow to check that the code is correctly linted and that all tests pass.

It groups together these reusable workflows:

-   _springboot-step-lint-check.yml_
-   _springboot-step-tests.yml_

It requires these inputs:

-   **NATIVE_CI_LABELS**: the _labels_ to select the correct _github-runner_ that will execute workflows **WITHOUT** docker. The format is a stringified JSON list of labels.
-   **CONTAINER_CI_LABELS**: the _labels_ to select the correct _github-runner_ that will execute workflows **WITH** docker. The format is a stringified JSON list of labels.
-   **WORKING_DIRECTORY**: The directory where the runner can execute all the commands. This is basically the directory which contains the Django application.
-   **JAVA_IMAGE**: The Java Docker image where the runner execute all the commands.

In addition, it is possible to specify this optional input:

-   **COVERAGE_ARTIFACT_NAME**: The artifact's name for the _jacoco reports_ file. By default, it is **target**.
-   **MAVEN_USER_HOME**: The path to Maven directory. By default, it is **./m2**.
-   **EXTRA_MAVEN_ARGS**: Additional arguments for Maven. By default, it is **""**.
-   **USE_CI_POSTGRES**: Whether to use Postgres for tests or not. If enabled, it injects the connection string to the DB for tests. By default, it is **true**.
-   **RUN**: Whether to run all the inside workflows or not. This is useful when you want to skip checks since the code didn't change. By default, it is **true**.

This is an example to show how data should be formatted.

```yaml
jobs:
    java-common:
        uses: zupit-it/pipeline-templates/.github/workflows/springboot-workflow-common.yml@v1.15.6
        with:
            NATIVE_CI_LABELS: "['pinga', 'pipeline', 'native']"
            CONTAINER_CI_LABELS: "['pinga', 'pipeline', 'container']"
            WORKING_DIRECTORY: backend
            JAVA_IMAGE: openjdk:12
            USE_CI_POSTGRES: false
        secrets: inherit
```

##### Run Optimization

This workflow allows to skip the inner jobs using the input variable **RUN**.
This is useful when the code didn't change, and you want to skip the required checks and allow the PR to move on.
One way to check whether the code changed or not is by using the **dorny/paths-filter@v2** action.
Here is an example of how to know if the code changed and based from that, run or not the workflows.

```yaml
jobs:
    check-changes:
        runs-on: [pinga, pipeline, native]

        outputs:
            backend: ${{ steps.changes.outputs.backend }}
            frontend: ${{ steps.changes.outputs.frontend }}

        steps:
            - uses: dorny/paths-filter@v2
              id: changes
              with:
                  filters: |
                      backend:
                        - 'backend/**'
                      frontend:
                        - 'frontend/**'

    java-common:
        uses: zupit-it/pipeline-templates/.github/workflows/springboot-workflow-common.yml@v1.15.6
        with:
            NATIVE_CI_LABELS: "['pinga', 'pipeline', 'native']"
            CONTAINER_CI_LABELS: "['pinga', 'pipeline', 'container']"
            WORKING_DIRECTORY: backend
            JAVA_IMAGE: openjdk:12
            USE_CI_POSTGRES: false
            RUN: ${{ needs.check-changes.outputs.backend == 'true' }}
        secrets: inherit
```

This basically checks if the 2 folders: **backend** and **frontend**, were touched or not.
If there are any change in the **backend** folder, then execute all inner workflows inside **django-workflow-common**.

---

#### SpringBoot build docker image and push to registry

###### Requirements

This workflow requires this plugin:

1. **jib**: Build and publish docker image to the given registry.

This workflow uses **Maven** as package manager.

###### Workflow

**springboot-step-docker-build-and-push-image.yml** is the workflow that builds the docker image and then push it to the registry.

_This workflow uses a Java Docker image, hence remember to use labels to match runners specific for Docker._

It requires these inputs:

-   **LABELS**: the _labels_ to select the correct _github-runner_ that will execute this workflow. The format is a stringified JSON list of labels.
-   **JAVA_IMAGE**: The Java image required to build the project.
-   **RELEASE_ENVIRONMENT**: The environment for which the project must be compiled (e.g. _testing_, _staging_, _production_).
-   **WORKING_DIRECTORY**: The directory where the runner can execute all the commands.
-   **REGISTRY_URL**: The registry url where to push the Docker image.
-   **DOCKER_IMAGE_NAME**: The name to assign to the built Docker image.
-   **DOCKER_IMAGE_TAG**: The tag to assign to the built Docker image.

In addition, it is possible to specify this optional input:

-   **MAVEN_USER_HOME**: The path to Maven directory. By default, it is **./m2**.
-   **EXTRA_MAVEN_ARGS**: Additional arguments for Maven. By default, it is **""**.

It then outputs this variable:

-   **DOCKER_IMAGE_NAME**: The final Docker image name with the registry path included.

This is an example to show how data should be formatted.

```yaml
jobs:
    springboot-build-and-push-image:
        needs: [common]

        uses: zupit-it/pipeline-templates/.github/workflows/springboot-step-docker-build-and-push-image.yml@v1.15.6
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

### .NET

#### .NET Common

###### Requirements

This workflow is based on the following actions:

-   [.NET - Install](#net-action---install)
-   [.NET - Build](#net-action---build)
-   [.NET - Format](#net-action---format)
-   [.NET - Lint](#net-action---lint)
-   [.NET - Test](#net-action---test)

Check these actions requirements before using this workflow.

###### Workflow

**dotnet-workflow-common.yml** is the reusable workflow to check that the code is correctly linted, formatted, and that all tests pass.

It requires these inputs:

-   **WORKING_DIRECTORY**: check actions used by this workflow for more information.
-   **CONTAINER_CI_LABELS**: the _labels_ to select the correct _github-runner_ that will execute workflows **WITHOUT** docker. The format is a stringified JSON list of labels.
-   **DOTNET_IMAGE**: the .NET docker image (usually 'mcr.microsoft.com/dotnet/sdk') to use.

In addition, it is possible to specify these optional inputs:
-   **DOTNET_IMAGE_ENV_VARIABLES**: The environment variables to set when running the .NET docker image.
-   **CSHARPIER_VERSION**: The version of the CSharpier tool to use. For the default value, see the `dotnet/format` action.
-   **RUN_LINT**: Whatever or not the lint command should be executed. By default, it is **true**.


This is an example to show how data should be formatted.

```yaml
jobs:
    common:
        uses: zupit-it/pipeline-templates/.github/workflows/dotnet-workflow-common.yml@v1.15.6
        with:
            WORKING_DIRECTORY: "backend"
            DOTNET_IMAGE: "'mcr.microsoft.com/dotnet/sdk:7.0"
            CONTAINER_CI_LABELS: "['team', 'pipeline', 'container']"
```

---

### Docker

#### Docker build docker image and push to registry

###### Requirements

This workflow requires a **Dockerfile** inside the _working directory_ to create the docker image to publish on a docker registry.

The github runner which will execute this workflow should be capable of running docker commands.

###### Workflow

**docker-step-build-and-push-image.yml** is the workflow that builds the Docker image and then push it to the registry.

This workflow uses this composite action:

-   **actions/docker/build-and-push**: creates the Docker image and pushes it to the desired registry.

It requires these inputs:

-   **LABELS**: the _labels_ to select the correct _github-runner_ that will execute this workflow. The format is a stringified JSON list of labels.
-   **WORKING_DIRECTORY**: The directory where the runner can execute all the commands.
-   **RELEASE_ENVIRONMENT**: The environment for which the project must be compiled (e.g. _testing_, _staging_, _production_).
-   **DOCKERFILE_PATH**: The path to the Dockerfile to build.
-   **DOCKER_IMAGE_NAME**: The name to assign to the built Docker image.
-   **DOCKER_IMAGE_TAG**: The tag to assign to the built Docker image.
-   **BUILD_ARGS**: Additional data to pass when building the Dockerfile.

In addition, it is possible to specify these optional inputs:

-   **REGISTRY_URL**: The registry url where to push the Docker image. By default, it is **ghcr.io**.
-   **REGISTRY_USER**: The registry url where to push the Docker image.
    By default, it is the GitHub variable **github.actor**, the user who started the workflow. If you need a different user, remember to override the **GITHUB_TOKEN** secret.
-   **CHECKOUT_REF**: The ref of the branch/tag to check out before running the build. See the ref parameter of the [checkout action](https://github.com/actions/checkout). By default, it is `''`.

It then outputs these variables:

-   **DOCKER_IMAGE_NAME**: The final Docker image name with the registry path included.

This is an example to show how data should be formatted.

```yaml
jobs:
    build-and-push-image:
        uses: zupit-it/pipeline-templates/.github/workflows/docker-step-build-and-push-image.yml@v1.15.6
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

-   **LABELS**: the _labels_ to select the correct _github-runner_ that will execute this workflow. The format is a stringified JSON list of labels.
-   **ENVIRONMENT**: The target environment that will show GitHub on the GitHub action page.
-   **DEPLOY_URL**: The target environment url that will show GitHub on the GitHub action page.
-   **REGISTRY_URL**: The registry url where to pull the Docker images.
-   **PROJECT_NAME**: The name that will be associated to the Docker Compose stack.
-   **DOCKER_COMPOSE_PATH**: The path to the docker-compose file to start.
-   **DOCKER_COMPOSE_EXTRA_ARGS**: Extra arguments to pass to the docker-compose command. Optional
-   **IMAGES**: A stringified json object containing as key the environment variables images used in the
    Docker compose file and as value the name of the images that will be downloaded from the registry.
    You can retrieve dynamically the image name from the _docker build and push step_ by adding the step's name to the **needs** array of the workflow
    and using `${{ needs.{STEP_NAME}.outputs.DOCKER_IMAGE_NAME }}` where STEP_NAME is the step's name.

This is an example to show how data should be formatted.

```yaml
jobs:
    deploy:
        uses: zupit-it/pipeline-templates/.github/workflows/docker-step-deploy.yml@v1.15.6
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

-   `latest`: for testing environment. This won't be deleted.
-   `v[0-9]+.[0-9]+.[0-9]+-rc`: for staging environment.
-   `v[0-9]+.[0-9]+.[0-9]+`: for production environment.

It requires these inputs:

-   **LABELS**: the _labels_ to select the correct _github-runner_ that will execute this workflow. The format is a stringified JSON list of labels.
-   **IMAGE_NAME**: The image name to apply the retention policy.
-   **KEEP_AT_LEAST**: The number of tagged version to maintain for both staging and production environments.

It also requires these secrets:

-   **RETENTION_POLICY_TOKEN**: A PAT with permissions to **read:packages** and **delete:packages**

In addition, it is possible to specify these optional inputs:

-   **DRY_RUN**: Only for tagged images, it shows which ones will be deleted without deleting them. By default, it is **false**.

This is an example to show how data should be formatted.

```yaml
jobs:
    clean-ionic-images:
        uses: zupit-it/pipeline-templates/.github/workflows/docker-step-delete-images.yml@v1.15.6
        with:
            LABELS: "['pinga', 'pipeline', 'native']"
            IMAGE_NAME: "ionic"
        secrets: inherit
```

---

### Jira

#### Jira Move Issue

###### Workflow

**jira-step-move-issue.yml** is the workflow that moves Jira issues to the desired state.

> **NOTE**: If the issue is in the 'Verified' state, the issue won't be moved to the desired state.

It requires these inputs:

-   **LABELS**: the _labels_ to select the correct _github-runner_ that will execute this workflow. The format is a stringified JSON list of labels.
-   **STATUS**: the final status of the Jira issue.
-   **BRANCH_OR_COMMIT_TITLE**: the branch or commit title from where extract the Jira issue key.

It also requires these secrets:

-   **JIRA_BASE_URL**: the JIRA url.
-   **JIRA_USER_EMAIL**: the JIRA user account email.
-   **JIRA_API_TOKEN**: the token to login the Jira user account email.

This is an example to show how data should be formatted.

```yaml
jobs:
    jira-move-issue-to-developed:
        uses: zupit-it/pipeline-templates/.github/workflows/jira-step-move-issue.yml@v1.15.6
        with:
            LABELS: "['pinga', 'pipeline', 'native']"
            STATUS: Developed
            BRANCH_OR_COMMIT_TITLE: ${{ github.event.workflow_run.head_commit.message }}
        secrets: inherit
```

###### Use Cases Workflows

Here we show 3 use cases that you can copy paste in your project to have the default configuration for transitioning
Jira issues to these 3 states: _In Progress_, _Merge Request_ and _Developed_, without worrying about how to retrieve
the branch or commit title based on the workflow type.

Basically, these workflows starts with these events:

-   **Pull Request opened**: Move the Jira issue to _In Progress_.
-   **Pull Request review**: Move the Jira issue to _Merge Request_ if the PR is not in draft.
-   **Pull Request ready for review**: Move the Jira issue to _Merge Request_.
-   **On main workflow completion**: Move the Jira issue to _Developed_.

**Move to In Progress** - _jira-move-in-progress.yml_

```yaml
name: Jira Move to In Progress

on:
    pull_request:
        types: [opened]

jobs:
    jira-move-issue-to-in-progress:
        uses: zupit-it/pipeline-templates/.github/workflows/jira-step-move-issue.yml@v1.15.6
        with:
            LABELS: "['pinga', 'pipeline', 'native']"
            STATUS: "In progress"
            BRANCH_OR_COMMIT_TITLE: ${{ github.head_ref }}
        secrets: inherit
```

---

**Move to Merge Request** - _jira-move-merge-request.yml_

```yaml
name: Jira Move to Merge Request

on:
    pull_request:
        types: [review_requested, ready_for_review]

jobs:
    jira-move-issue-to-merge-request:
        if: ${{ !github.event.pull_request.draft }}
        uses: zupit-it/pipeline-templates/.github/workflows/jira-step-move-issue.yml@v1.15.6
        with:
            LABELS: "['pinga', 'pipeline', 'native']"
            STATUS: "Merge request"
            BRANCH_OR_COMMIT_TITLE: ${{ github.head_ref }}
        secrets: inherit
```

---

**Move to Developed** - _jira-move-developed.yml_

```yaml
name: Jira Move to Developed

on:
    workflow_run:
        workflows: [Main Workflow]
        types:
            - completed

jobs:
    jira-move-issue-to-developed:
        uses: zupit-it/pipeline-templates/.github/workflows/jira-step-move-issue.yml@v1.15.6
        if: ${{ github.event.workflow_run.conclusion == 'success' }}
        with:
            LABELS: "['pinga', 'pipeline', 'native']"
            STATUS: "Developed"
            BRANCH_OR_COMMIT_TITLE: ${{ github.event.workflow_run.head_commit.message }}
        secrets: inherit
```

---

### Conventional Commits

#### Conventional Commits Lint Step

**conventional-commits-step-lint.yml** is the workflow that lint the commit messages of a pull request.

It requires these inputs:

-   **LABELS**: the _labels_ to select the correct _github-runner_ that will execute this workflow. The format is a stringified JSON list of labels.
-   **CONFIG_FILE**: the config file name (by default it is **.commitlintrc**).

This is an example to show how data should be formatted.

```yaml
jobs:
    lint-pr:
        uses: zupit-it/pipeline-templates/.github/workflows/conventional-commits-step-lint.yml@v1.15.6
        with:
            LABELS: "['pinga', 'pipeline', 'native']"
            CONFIG_FILE: .commitlintrc.json
        secrets: inherit
```

#### Conventional Commits Release Step

**conventional-commits-step-release.yml** is the workflow that automatically creates a new release based on the commit messages.

It requires these inputs:

-   **LABELS**: the _labels_ to select the correct _github-runner_ that will execute this workflow. The format is a stringified JSON list of labels.

It also requires these secrets:

-   **RELEASE_TOKEN**: a personal access token with grants to create a release and to push new commits. (use the zupit bot)

This is an example to show how data should be formatted.

```yaml
jobs:
    lint-pr:
        uses: zupit-it/pipeline-templates/.github/workflows/conventional-commits-step-release.yml@v1.15.6
        with:
            LABELS: "['pinga', 'pipeline', 'native']"
        secrets: inherit
```

---

### Others

#### Sonar Analyze

###### Requirements

This workflow requires a **sonar-project.properties** file inside the _working directory_ with the configuration for Sonarqube.

###### Workflow

**sonar-step-analyze.yml** is the workflow that analyze the coverage and sends the results to Sonarqube.

It requires these inputs:

-   **LABELS**: the _labels_ to select the correct _github-runner_ that will execute this workflow. The format is a stringified JSON list of labels.
-   **WORKING_DIRECTORY**: The directory where the runner can execute all the commands.

It also requires these secrets:

-   **SONAR_TOKEN**: The Sonarqube token.

In addition, it is possible to specify these optional inputs:

-   **SONAR_IMAGE**: The Sonarqube docker image where the runner execute all commands. By default, it is **sonarsource/sonar-scanner-cli**.
-   **SONAR_HOST_URL**: The Sonarqube host to where submit analyzed data. By default, it is **https://sonarqube.zupit.software**
-   **DOWNLOAD_ARTIFACT**: Whether it should download an artifact or not to analyze. By default, it is **true**.
-   **ARTIFACT_FILENAME**: The name of the artifact. By default, it is an empty string.

This is an example to show how data should be formatted.

```yaml
jobs:
    angular-sonar-analyze:
        uses: zupit-it/pipeline-templates/.github/workflows/sonar-step-analyze.yml@v1.15.6
        with:
            WORKING_DIRECTORY: frontend
            ARTIFACT_FILENAME: lcov.info
            LABELS: "['pinga', 'pipeline', 'container']"
        secrets: inherit
```

If you want to analyze a Dart or Flutter project, you should use this workflow in the following way:

```yaml
    flutter-sonar-analyze:
        uses: zupit-it/pipeline-templates/.github/workflows/sonar-step-analyze.yml@1.12.0
        with:
            WORKING_DIRECTORY: '.'
            DOWNLOAD_ARTIFACT: false
            PRE_SCAN_COMMANDS: 'git config --global --add safe.directory /opt/flutter && mv .env.github .env && flutter pub get && flutter test --machine --coverage > tests.output'
            SONAR_IMAGE: 'ghcr.io/zupit-it/pipeline-templates/flutter-sonar-scanner-cli:latest'
        secrets: inherit
```

#### Sonar Analyze - .NET

###### Requirements

This workflow DOES NOT use the **sonar-project.properties** as the [Sonar Analyze](#sonar-analyze) workflow does. See the [documentation](https://community.sonarsource.com/t/how-to-specify-sonar-project-properties-file-in-dotnet-scanner-command/31805/3).

Additional properties are provided by this workflow and the required ones are exposed as required inputs.

###### Workflow

**sonar-step-dotnet-analyze.yml** is the workflow that analyze a .NET solution, including the coverage, and sends the results to Sonarqube.

**IMPORTANT:** since this step relies on bash scripting, the _CONTAINER_CI_LABELS_ you provide must reference a container with bash already installed.

It requires these inputs:

-   **CONTAINER_CI_LABELS**: the _labels_ to select the correct _github-runner_ that will execute this workflow. The format is a stringified JSON list of labels. The runner MUST be _docker_ based.
-   **WORKING_DIRECTORY**: The directory where the runner can execute all the commands.
-   **SONAR_PROJECT_KEY**: The SonarQube project key.

It also requires these secrets:

-   **SONAR_TOKEN**: The Sonarqube token.

In addition, it is possible to specify these optional inputs:

-   **SONAR_IMAGE**: The SonarQube docker image where the runner execute all commands. By default, it is `sonarsource/sonar-scanner-cli`.
-   **SONAR_HOST_URL**: The Sonarqube host to where submit analyzed data. By default, it is `https://sonarqube.zupit.software`.
-   **SONAR_EXCLUSIONS**: A comma separated list of glob patterns to match files and/or folders that should be excluded from Sonarqube analysis. You can't use a `sonar-project.properties` file since it's [not supported](https://community.sonarsource.com/t/configure-net-core-analysis-with-configuration-file/41299/2) from SonarScanner for .NET.
-   **COVERAGE_EXCLUSIONS**: A comma separated list of glob patterns to match files and/or folders that should be excluded when computing tests code coverage ([docs](https://github.com/coverlet-coverage/coverlet/blob/master/Documentation/MSBuildIntegration.md#source-files)). Since `dotnet test` expect absolute path for the exclusion list, you should provide this parameter in the form `**/my-path/*.cs` (always starting with `**/*`).
-   **DOTNET_VERSION**: The .NET version to build the solution. By default, it is `7`.

This is an example to show how data should be formatted.

```yaml
jobs:
    sonar-analyze:
        uses: zupit-it/pipeline-templates/.github/workflows/sonar-step-dotnet-analyze.yml@v1.15.6
        with:
            CONTAINER_CI_LABELS: "['team', 'pipeline', 'container']"
            WORKING_DIRECTORY: "back-end"
            SONAR_PROJECT_KEY: "my-project-key"
        secrets: inherit
```
