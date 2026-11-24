import { metrics } from '@opentelemetry/api';
import type { BusyReason, ErrorCode } from '../../domain/errors';
// Routing's own numbers (ADR-0003). With telemetry off the meter is a no-op, so these calls cost nothing.
const meter = metrics.getMeter('routing-service');
const failures = meter.createCounter('routing_failures', { description: 'Requests answered with an error, by error code and (for ROUTING_BUSY) by the limit that was hit' });
const queueWait = meter.createHistogram('routing_pool_queue_wait', { unit: 'ms', description: 'Time a job waited for a free worker; outcome=started or abandoned',
  advice: { explicitBucketBoundaries: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500] } });
export function countFailure(code: ErrorCode, reason?: BusyReason): void { failures.add(1, { code, reason: reason ?? 'none' }); }
export function recordQueueWait(ms: number, started: boolean): void { queueWait.record(Math.max(0, ms), { outcome: started ? 'started' : 'abandoned' }); }
/** Reports how full the pool is each time metrics are collected. */
export function observePool(read: () => { running: number; queued: number; requests: number }): void {
  meter.createObservableGauge('routing_pool_running', { description: 'Jobs a worker is executing now (limit WORKER_POOL_SIZE)' }).addCallback(result => { result.observe(read().running); });
  meter.createObservableGauge('routing_pool_queued', { description: 'Jobs waiting for a worker now (limit QUEUE_MAX_SIZE)' }).addCallback(result => { result.observe(read().queued); });
  meter.createObservableGauge('routing_requests_in_flight', { description: 'HTTP requests being handled now (limit QUEUE_MAX_SIZE + WORKER_POOL_SIZE)' }).addCallback(result => { result.observe(read().requests); });
}
