import { metrics, trace } from '@opentelemetry/api';
// Outbox numbers (ADR-0003, ADR-0008). With telemetry off the meter is a no-op, so these calls cost nothing.
const meter = metrics.getMeter('trip-service');
const tracer = trace.getTracer('trip-service');
const lag = meter.createHistogram('trip_outbox_delivery_lag', { unit: 'ms', description: 'Time from an outbox message being written to its delivery being finished, by destination and outcome', advice: { explicitBucketBoundaries: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000] } });
const attempts = meter.createCounter('trip_outbox_deliveries', { description: 'Outbox delivery attempts by destination and outcome: delivered, skipped, retry, blocked' });
export type DeliveryOutcome = 'delivered' | 'skipped' | 'retry' | 'blocked';
/** ageMs is how old the message was when it was claimed; sinceClaim is the time spent sending it. */
export function recordDelivery(destination: string, outcome: DeliveryOutcome, ageMs: number | undefined, sinceClaim: number): void {
  attempts.add(1, { destination, outcome });
  if (ageMs !== undefined && (outcome === 'delivered' || outcome === 'skipped')) lag.record(Math.max(0, ageMs + sinceClaim), { destination, outcome });
}
/** Runs one delivery inside its own span, so its queries and its HTTP call show up as one trace. */
export function traced<T>(destination: string, tripId: string, work: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan('trip.outbox.deliver', { attributes: { 'trip.id': tripId, 'outbox.destination': destination } }, async span => { try { return await work(); } finally { span.end(); } });
}
