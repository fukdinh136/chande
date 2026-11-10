export type ErrorCode = 'INVALID_REQUEST' | 'UNSUPPORTED_VEHICLE_TYPE' | 'INVALID_SERVICE_CREDENTIAL' | 'FORBIDDEN_OPERATION' | 'NO_ROUTE' | 'UNSUPPORTED_CAPABILITY' | 'ROUTING_BUSY' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_CONFIGURATION_ERROR' | 'INVALID_PROVIDER_RESPONSE' | 'ROUTING_DEADLINE_EXCEEDED' | 'INTERNAL_ERROR';
export class RoutingError extends Error {
  constructor(public readonly code: ErrorCode, public readonly status: number, public readonly retryable = false, public readonly reason?: BusyReason) { super(code); }
}
// Why a request was turned away with ROUTING_BUSY. Callers all see the same 503; the reason is only for
// metrics (ADR-0003), so a load test can tell which limit was hit.
//   too_many_requests  more requests in flight than QUEUE_MAX_SIZE + WORKER_POOL_SIZE
//   queue_full         every worker busy and the queue already holds QUEUE_MAX_SIZE jobs
//   queue_wait         the job waited ROUTING_JOB_MAX_WAIT_MS in the queue without getting a worker
//   rate_limit         no request token within RATE_LIMIT_WAIT_TIMEOUT_MS
//   matrix_budget      the one-minute matrix element budget is used up
//   matrix_too_large   one request asks for more origins than the service accepts
//   shutting_down      the process is stopping
export type BusyReason = 'too_many_requests' | 'queue_full' | 'queue_wait' | 'rate_limit' | 'matrix_budget' | 'matrix_too_large' | 'shutting_down';
export const busy = (reason: BusyReason) => new RoutingError('ROUTING_BUSY', 503, false, reason);
export const deadline = () => new RoutingError('ROUTING_DEADLINE_EXCEEDED', 504);
export const invalidProvider = () => new RoutingError('INVALID_PROVIDER_RESPONSE', 503);
