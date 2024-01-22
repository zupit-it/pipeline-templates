#!/bin/bash

docker buildx build -t ghcr.io/zupit-it/pipeline-templates/sonar-scanner-cli:5.0.1 -f Dockerfile .
