// Observability bootstrap (ADR-0003). This file is the same in every Node service and must be the FIRST
// import of each entry point: OpenTelemetry patches http, fetch, pg, ioredis and amqplib when they are
// loaded, so anything imported before this file is not traced.
//
// It does nothing unless OTEL_EXPORTER_OTLP_ENDPOINT is set: no package is loaded, no timer is started.
// Service name, sampling and export interval come from the standard OTEL_* variables set at deploy time.
import { createRequire } from 'node:module';

// Loaded on demand so a process with telemetry off pays nothing.
const load = createRequire(__filename);
type Loaded = Record<string, new (config?: unknown) => unknown>;
type Incoming = { url?: string };

// Each service installs only the instrumentations it needs; a missing one is skipped.
function optional(name: string, exported: string, config?: unknown): unknown[] {
  let loaded: Loaded;
  try { loaded = load(name) as Loaded; } catch (error) {
    if ((error as { code?: string }).code === 'MODULE_NOT_FOUND') return [];
    throw error;
  }
  const Instrumentation = loaded[exported];
  return Instrumentation ? [new Instrumentation(config)] : [];
}

function start(): void {
  process.env.OTEL_TRACES_EXPORTER ??= 'otlp';
  process.env.OTEL_METRICS_EXPORTER ??= 'otlp';
  process.env.OTEL_LOGS_EXPORTER ??= 'none';
  process.env.OTEL_EXPORTER_OTLP_PROTOCOL ??= 'http/protobuf';
  const { startNodeSDK } = load('@opentelemetry/sdk-node') as { startNodeSDK: (options: { instrumentations: unknown[] }) => { shutdown: () => Promise<void> } };
  const sdk = startNodeSDK({
    instrumentations: [
      // Health probes run every few seconds and would bury the real requests.
      ...optional('@opentelemetry/instrumentation-http', 'HttpInstrumentation', { ignoreIncomingRequestHook: (request: Incoming) => request.url?.startsWith('/health') === true }),
      ...optional('@opentelemetry/instrumentation-undici', 'UndiciInstrumentation'),
      ...optional('@opentelemetry/instrumentation-grpc', 'GrpcInstrumentation'),
      ...optional('@opentelemetry/instrumentation-runtime-node', 'RuntimeNodeInstrumentation'),
      // A query with no span around it (the polling loops of the workers) is not traced: on its own it says
      // nothing and thousands of them per minute fill the trace store.
      ...optional('@opentelemetry/instrumentation-pg', 'PgInstrumentation', { requireParentSpan: true }),
      ...optional('@opentelemetry/instrumentation-ioredis', 'IORedisInstrumentation'),
      ...optional('@opentelemetry/instrumentation-amqplib', 'AmqplibInstrumentation'),
    ],
  });
  // Send what is still buffered when the process is asked to stop; the service's own handler closes the rest.
  const flush = () => { void sdk.shutdown().catch(() => undefined); };
  process.once('SIGTERM', flush); process.once('SIGINT', flush);
}

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT && process.env.OTEL_SDK_DISABLED !== 'true') start();
