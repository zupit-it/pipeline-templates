FROM ubuntu

LABEL org.opencontainers.image.source=https://github.com/zupit-it/pipeline-templates
RUN apt update -y && apt install -y curl xz-utils clang cmake git ninja-build pkg-config libgtk-3-dev liblzma-dev libstdc++-12-dev openjdk-11-jre wget unzip jq && apt clean -y

WORKDIR /opt

ENV FLUTTER_VERSION="3.16.8"
ENV FLUTTER_HOME "/opt/flutter"
ENV PATH $PATH:$FLUTTER_HOME/bin:/opt/sonar-scanner-cli/bin

# Download and extract Flutter SDK
RUN mkdir $FLUTTER_HOME \
    && cd $FLUTTER_HOME \
    && curl --fail --remote-time --silent --location -O https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_${FLUTTER_VERSION}-stable.tar.xz

RUN cd $FLUTTER_HOME && tar -xf flutter_linux_${FLUTTER_VERSION}-stable.tar.xz --strip-components=1 \
    && rm flutter_linux_${FLUTTER_VERSION}-stable.tar.xz

RUN flutter precache

ENV SONAR_VERSION "5.0.1.3006-linux"
ENV SONAR_ZIP_FILE "sonar-scanner-cli-${SONAR_VERSION}.zip"

RUN wget -q "https://binaries.sonarsource.com/Distribution/sonar-scanner-cli/${SONAR_ZIP_FILE}"
RUN unzip ${SONAR_ZIP_FILE}
RUN rm -v ${SONAR_ZIP_FILE}
RUN mv sonar-scanner-${SONAR_VERSION} /opt/sonar-scanner-cli

RUN wget -O '/usr/bin/entrypoint.sh' 'https://raw.githubusercontent.com/SonarSource/sonar-scanner-cli-docker/master/5/bin/entrypoint.sh'
RUN chmod +x /usr/bin/entrypoint.sh

RUN git config --global --add safe.directory /opt/flutter

WORKDIR /usr/src

ENTRYPOINT ["/usr/bin/entrypoint.sh"]

CMD ["sonar-scanner"]
