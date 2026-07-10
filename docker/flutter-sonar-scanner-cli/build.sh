#!/bin/bash

docker buildx build -t ghcr.io/zupit-it/pipeline-templates/flutter-sonar-scanner-cli:sonarqube5.0.1-flutter3.41.9 -f Dockerfile .
docker push ghcr.io/zupit-it/pipeline-templates/flutter-sonar-scanner-cli:sonarqube5.0.1-flutter3.41.9
# docker push ghcr.io/zupit-it/pipeline-templates/flutter-sonar-scanner-cli:latest
