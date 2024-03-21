#!/bin/bash

docker buildx build -t ghcr.io/zupit-it/pipeline-templates/sonar-scanner-cli:5.0.1 -t ghcr.io/zupit-it/pipeline-templates/sonar-scanner-cli:latest -f Dockerfile .
docker push ghcr.io/zupit-it/pipeline-templates/sonar-scanner-cli:5.0.1
docker push ghcr.io/zupit-it/pipeline-templates/sonar-scanner-cli:latest
