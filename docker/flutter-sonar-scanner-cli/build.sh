#!/bin/bash

docker buildx build -t ghcr.io/zupit-it/pipeline-templates/flutter-sonar-scanner-cli:sonarqube5.0.1-flutter3.38.4 -f Dockerfile .
docker push ghcr.io/zupit-it/pipeline-templates/flutter-sonar-scanner-cli:sonarqube5.0.1-flutter3.38.4
# docker push ghcr.io/zupit-it/pipeline-templates/flutter-sonar-scanner-cli:latest
