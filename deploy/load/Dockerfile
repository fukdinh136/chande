# Load-test runner for in-cluster runs (E1): the driver simulator and k6 talk to the edge Service directly,
# so traffic does not go through kubectl port-forward. Build: docker build -t chande-load:local deploy/load
FROM grafana/k6:2.3.0@sha256:2dd4756ec6e14e62778916e1eb850108e4b499304c02df56760fa0bdb0fba0b8 AS k6

FROM node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d
WORKDIR /load
# drivers.cjs loads socket.io-client from Matching's node_modules; install the same version at that path.
RUN npm install --prefix service/matching-service --no-save --no-package-lock --no-audit --no-fund socket.io-client@4.8.4
COPY --from=k6 /usr/bin/k6 /usr/bin/k6
COPY *.cjs *.js deploy/load/
RUN mkdir -p deploy/.local/load /work/out && chown -R node:node /load /work
USER node
ENV LOAD_IN_CLUSTER=1 BACKEND_URL=http://edge:8088
CMD ["sleep", "infinity"]
