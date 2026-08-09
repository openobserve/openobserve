FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build
COPY pom.xml .
RUN mvn -q -B dependency:go-offline
COPY src ./src
RUN mvn -q -B package dependency:copy-dependencies -DincludeScope=runtime

FROM eclipse-temurin:21-jre
# javaagent pin (latest release at capture time; recorded in CAPTURE_LOG.md)
ARG OTEL_AGENT_VERSION=v2.30.0
ADD https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/${OTEL_AGENT_VERSION}/opentelemetry-javaagent.jar /otel/opentelemetry-javaagent.jar
RUN echo "${OTEL_AGENT_VERSION}" > /otel/agent-version.txt
WORKDIR /app
COPY --from=build /build/target/classes ./classes
COPY --from=build /build/target/dependency ./lib
ENV JAVA_TOOL_OPTIONS="-javaagent:/otel/opentelemetry-javaagent.jar"
CMD ["java", "-cp", "classes:lib/*", "App"]
