import { metrics, trace } from '@opentelemetry/api';
// Matching's own numbers (ADR-0003). With telemetry off the meter is a no-op, so these calls cost nothing.
const meter = metrics.getMeter('matching-service');
const tracer = trace.getTracer('matching-service');
const MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
const stepDuration = meter.createHistogram('matching_search_step_duration', { unit: 'ms', description: 'Time of each step of one candidate search: locations (Realtime), exclude (own DB), eligibility (Driver), eta (Routing)', advice: { explicitBucketBoundaries: MS } });
const funnel = meter.createCounter('matching_search_drivers', { description: 'Drivers left after each step of the search funnel: nearby, open, eligible, ranked' });
const searches = meter.createCounter('matching_searches', { description: 'Candidate searches by result: found, or the step where the list became empty' });
const jobDuration = meter.createHistogram('matching_job_duration', { unit: 'ms', description: 'Time of one worker job (search or assignment), by outcome', advice: { explicitBucketBoundaries: MS } });
const outboxLag = meter.createHistogram('matching_outbox_publish_lag', { unit: 'ms', description: 'Time from an offer message being due to the broker confirming it', advice: { explicitBucketBoundaries: MS } });
export type SearchStep = 'locations' | 'exclude' | 'eligibility' | 'eta';
export type FunnelStage = 'nearby' | 'open' | 'eligible' | 'ranked';
/** Runs one search step and records how long it took, whether it succeeded or threw. */
export async function timed<T>(step: SearchStep, work: () => Promise<T>): Promise<T> {
  const started = performance.now(); let ok = false;
  try { const result = await work(); ok = true; return result; } finally { stepDuration.record(performance.now() - started, { step, ok }); }
}
export function countDrivers(stage: FunnelStage, drivers: number): void { funnel.add(drivers, { stage }); }
export function countSearch(result: 'found' | 'no_nearby' | 'no_open' | 'no_eligible' | 'no_route'): void { searches.add(1, { result }); }
export function recordJob(ms: number, kind: 'search' | 'assignment', outcome: 'done' | 'retry'): void { jobDuration.record(ms, { kind, outcome }); }
export function recordOutboxLag(ms: number): void { outboxLag.record(Math.max(0, ms)); }
/** Runs one polled job inside its own span, so its queries and calls show up as one trace. */
export function traced<T>(name: string, tripId: string, work: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, { attributes: { 'trip.id': tripId } }, async span => { try { return await work(); } finally { span.end(); } });
}
