export type ErrorCode = 'INVALID_REQUEST' | 'UNSUPPORTED_VEHICLE_TYPE' | 'INVALID_SERVICE_CREDENTIAL' | 'FORBIDDEN_OPERATION' | 'NO_ROUTE' | 'UNSUPPORTED_CAPABILITY' | 'ROUTING_BUSY' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_CONFIGURATION_ERROR' | 'INVALID_PROVIDER_RESPONSE' | 'REALTIME_UNAVAILABLE' | 'REALTIME_CONFIGURATION_ERROR' | 'INVALID_REALTIME_RESPONSE' | 'REALTIME_DEADLINE_EXCEEDED' | 'ROUTING_DEADLINE_EXCEEDED' | 'INTERNAL_ERROR';
export class RoutingError extends Error {
  constructor(public readonly code: ErrorCode, public readonly status: number, public readonly retryable = false) { super(code); }
}
export const busy = () => new RoutingError('ROUTING_BUSY', 503);
export const deadline = () => new RoutingError('ROUTING_DEADLINE_EXCEEDED', 504);
export const invalidProvider = () => new RoutingError('INVALID_PROVIDER_RESPONSE', 503);
