FROM maven:3.9.12-eclipse-temurin-21@sha256:c3c9d3ac4ce8431a3995c0318b8d390f448e693dd4fabc16e9b68d2e1f3d7b46 AS build
WORKDIR /src
COPY pom.xml ./
COPY src ./src
RUN --mount=type=cache,target=/root/.m2 mvn -B -DskipTests package

FROM eclipse-temurin:21-jre-jammy@sha256:f04fb34e053148344e83317976114ec3f37e4b830ec8bdab5a2fe3cecd7d010b AS base
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=70 -XX:ActiveProcessorCount=2"
USER 10001:10001
EXPOSE 8080 8090
ENTRYPOINT ["java", "-jar", "/app/app.jar"]

FROM base AS runtime-prebuilt
COPY --chown=10001:10001 target/api-gateway-0.0.1-SNAPSHOT.jar /app/app.jar

FROM base AS runtime
COPY --from=build --chown=10001:10001 /src/target/api-gateway-0.0.1-SNAPSHOT.jar /app/app.jar
