import { metrics, SpanStatusCode, trace } from '@opentelemetry/api';
// Realtime's own numbers (ADR-0003). With telemetry off the meter and tracer are no-ops.
const meter = metrics.getMeter('realtime-service');
const tracer = trace.getTracer('realtime-service');
const duration = meter.createHistogram('realtime_location_update_duration', { unit: 'ms', description: 'Time to handle one driver.location.update message, by result code', advice: { explicitBucketBoundaries: [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500] } });
/** Reports how many driver sockets this process holds. */
export function observeSockets(read: () => number): void {
  meter.createObservableGauge('realtime_connected_sockets', { description: 'Driver sockets connected to this process' }).addCallback(result => { result.observe(read()); });
}
/**
 * Runs one GPS message inside a span and records its duration. A socket message has no HTTP request around it,
 * so without this span the Redis calls it makes would not be traced at all. `code` reads the result code from the
 * reply ("OK" on success).
 */
export async function measured<T>(work: () => Promise<T>, code: (reply: T) => string): Promise<T> {
  const started = performance.now();
  return tracer.startActiveSpan('driver.location.update', async span => {
    let result = 'INTERNAL_ERROR';
    try {
      const reply = await work(); result = code(reply);
      if (result !== 'OK') span.setStatus({ code: SpanStatusCode.ERROR, message: result });
      return reply;
    } finally { span.setAttribute('realtime.result', result); span.end(); duration.record(performance.now() - started, { result }); }
  });
}
