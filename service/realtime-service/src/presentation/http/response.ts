import { randomUUID } from 'node:crypto';
import { Request } from 'express';
import { RealtimeError } from '../../domain/errors';
export type RealtimeRequest = Request & { requestId: string };
export const envelope = <T>(data: T, requestId: string) => ({ data, meta: { requestId } });
export function errorResponse(error: unknown, requestId: string = randomUUID()) {
  const code = error instanceof RealtimeError ? error.code : 'INTERNAL_ERROR';
  return { error: { code, message: code, details: [] }, meta: { requestId } };
}
export function statusFor(code: string) {
  if (code === 'UNAUTHENTICATED' || code === 'INVALID_SERVICE_CREDENTIAL') return 401;
  if (['INVALID_REQUEST', 'LOCATION_IN_FUTURE', 'LOCATION_STALE'].includes(code)) return 400;
  if (code === 'LOCATION_OUT_OF_ORDER') return 409;
  if (code === 'RATE_LIMITED') return 429;
  if (['DEPENDENCY_UNAVAILABLE', 'ELIGIBILITY_UNDETERMINED', 'SEARCH_CAPACITY_EXCEEDED'].includes(code)) return 503;
  return 500;
}
