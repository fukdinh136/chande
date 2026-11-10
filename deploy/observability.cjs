// Observability stack (ADR-0003): OpenTelemetry Collector -> Jaeger (traces) and Prometheus (metrics) -> Grafana.
// It is generated only when OBSERVABILITY=on at `node deploy/run.cjs generate|kube-up|docker-up`; otherwise the
// services get no OTEL_* variable, their telemetry bootstrap stays idle, and none of this is deployed.
const fs = require('node:fs'), path = require('node:path');
const images = {
  collector: 'otel/opentelemetry-collector-contrib:0.119.0', jaeger: 'jaegertracing/all-in-one:1.65.0',
  prometheus: 'prom/prometheus:v3.1.0', grafana: 'grafana/grafana:11.4.0',
};
// Loopback ports on the developer machine (Compose publishes them, Kubernetes port-forwards them).
const ports = { grafana: [13000, 3000], jaeger: [16686, 16686], prometheus: [19090, 9090] };
const enabled = () => process.env.OBSERVABILITY === 'on';
/** Share of traces kept, 0..1. Metrics are never sampled. */
function sampleRatio() {
  const ratio = Number(process.env.OTEL_SAMPLE_RATIO ?? '0.1');
  if (!(ratio >= 0 && ratio <= 1)) throw new Error('OTEL_SAMPLE_RATIO must be a number 0..1');
  return String(ratio);
}
/** Variables that switch one Node process's telemetry on. `name` is what Jaeger and Grafana show (trip-api, trip-worker...). */
const telemetryEnv = name => ({
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel-collector:4318', OTEL_SERVICE_NAME: name,
  OTEL_TRACES_SAMPLER: 'parentbased_traceidratio', OTEL_TRACES_SAMPLER_ARG: sampleRatio(),
  OTEL_METRIC_EXPORT_INTERVAL: '10000', OTEL_SEMCONV_STABILITY_OPT_IN: 'http',
});
// Collector, Prometheus and Grafana read YAML; JSON is valid YAML, so the files are written as JSON.
const collector = {
  receivers: { otlp: { protocols: { http: { endpoint: '0.0.0.0:4318' } } } },
  processors: { memory_limiter: { check_interval: '1s', limit_mib: 200 }, batch: {} },
  exporters: { 'otlp/jaeger': { endpoint: 'jaeger:4317', tls: { insecure: true } }, prometheus: { endpoint: '0.0.0.0:8889' } },
  extensions: { health_check: { endpoint: '0.0.0.0:13133' } },
  service: { extensions: ['health_check'], pipelines: {
    traces: { receivers: ['otlp'], processors: ['memory_limiter', 'batch'], exporters: ['otlp/jaeger'] },
    metrics: { receivers: ['otlp'], processors: ['memory_limiter', 'batch'], exporters: ['prometheus'] } } },
};
// honor_labels keeps the service name the Collector puts in `job` instead of replacing it with "otel-collector".
const prometheus = { global: { scrape_interval: '10s' }, scrape_configs: [{ job_name: 'otel-collector', honor_labels: true, static_configs: [{ targets: ['otel-collector:8889'] }] }] };
const datasources = { apiVersion: 1, datasources: [
  { name: 'Prometheus', uid: 'prometheus', type: 'prometheus', access: 'proxy', url: 'http://prometheus:9090', isDefault: true },
  { name: 'Jaeger', uid: 'jaeger', type: 'jaeger', access: 'proxy', url: 'http://jaeger:16686' }] };
const dashboards = { apiVersion: 1, providers: [{ name: 'chande', type: 'file', allowUiUpdates: false, options: { path: '/var/lib/grafana/dashboards' } }] };
/** Config files by name, and where each is mounted. */
function files() {
  return {
    'collector.yaml': { service: 'otel-collector', mount: '/etc/otelcol/config.yaml', content: JSON.stringify(collector, null, 2) },
    'prometheus.yml': { service: 'prometheus', mount: '/etc/prometheus/prometheus.yml', content: JSON.stringify(prometheus, null, 2) },
    'grafana-datasources.yaml': { service: 'grafana', mount: '/etc/grafana/provisioning/datasources/chande.yaml', content: JSON.stringify(datasources, null, 2) },
    'grafana-dashboards.yaml': { service: 'grafana', mount: '/etc/grafana/provisioning/dashboards/chande.yaml', content: JSON.stringify(dashboards, null, 2) },
    'chande-overview.json': { service: 'grafana', mount: '/var/lib/grafana/dashboards/chande-overview.json', content: fs.readFileSync(path.join(__dirname, 'observability', 'chande-overview.json'), 'utf8') },
  };
}
// Local only: anyone on the loopback port can read dashboards; changing them needs the generated admin password.
const grafanaEnv = password => ({ GF_SECURITY_ADMIN_PASSWORD: password, GF_AUTH_ANONYMOUS_ENABLED: 'true', GF_AUTH_ANONYMOUS_ORG_ROLE: 'Viewer', GF_ANALYTICS_REPORTING_ENABLED: 'false', GF_ANALYTICS_CHECK_FOR_UPDATES: 'false' });
const containers = password => ({
  'otel-collector': { image: images.collector, args: ['--config=/etc/otelcol/config.yaml'], ports: [4318, 8889], health: [13133, '/'], memory: '256Mi' },
  // Traces are kept in memory: enough for a load run, gone on restart.
  jaeger: { image: images.jaeger, env: { MEMORY_MAX_TRACES: '10000', GOMEMLIMIT: '400MiB' }, ports: [16686, 4317], health: [14269, '/'], memory: '512Mi' },
  prometheus: { image: images.prometheus, args: ['--config.file=/etc/prometheus/prometheus.yml', '--storage.tsdb.path=/prometheus', '--storage.tsdb.retention.time=2d'], ports: [9090], health: [9090, '/-/ready'], memory: '512Mi' },
  grafana: { image: images.grafana, env: grafanaEnv(password), ports: [3000], health: [3000, '/api/health'], memory: '256Mi' },
});
/** Compose services; `directory` is where the config files were written. */
function composeServices(directory, password) {
  const mounts = Object.entries(files()), services = {};
  for (const [name, c] of Object.entries(containers(password))) {
    services[name] = { image: c.image, ...(c.args ? { command: c.args } : {}), ...(c.env ? { environment: c.env } : {}),
      volumes: mounts.filter(([, f]) => f.service === name).map(([file, f]) => `${directory}/${file}:${f.mount}:ro`),
      ...(ports[name] ? { ports: [`127.0.0.1:${ports[name][0]}:${ports[name][1]}`] } : {}) };
  }
  return services;
}
/** Kubernetes resources, built with the generator's own helpers so they look like every other workload. */
function kubeResources({ deployment, service, metadata, secret, probeHTTP }, password) {
  const mounts = Object.entries(files()), resources = [];
  resources.push({ apiVersion: 'v1', kind: 'ConfigMap', metadata: metadata('observability-config'), data: Object.fromEntries(mounts.map(([file, f]) => [file, f.content])) }, secret('grafana-env', grafanaEnv(password)));
  for (const [name, c] of Object.entries(containers(password))) {
    const own = mounts.filter(([, f]) => f.service === name);
    const container = { image: c.image, ...(c.args ? { args: c.args } : {}), ports: c.ports.map(containerPort => ({ containerPort })), readinessProbe: probeHTTP(c.health[0], c.health[1]),
      ...(name === 'grafana' ? { envFrom: [{ secretRef: { name: 'grafana-env' } }] } : c.env ? { env: Object.entries(c.env).map(([key, value]) => ({ name: key, value })) } : {}),
      volumeMounts: own.map(([file, f]) => ({ name: 'config', mountPath: f.mount, subPath: file, readOnly: true })) };
    resources.push(deployment(name, container, own.length ? [{ name: 'config', configMap: { name: 'observability-config' } }] : [], c.memory), service(name, c.ports));
  }
  // One label to find and remove the whole stack when the flag is switched off.
  for (const resource of resources) resource.metadata.labels['app.kubernetes.io/component'] = 'observability';
  return resources;
}
module.exports = { enabled, telemetryEnv, files, composeServices, kubeResources, ports, images };
