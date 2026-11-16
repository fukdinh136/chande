import { Catch, HttpException, type ExceptionFilter, type ArgumentsHost } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Principal } from '../domain/models';
import { DomainError } from '../domain/error';
export type TripRequest = Request & { requestId: string; principal: Principal };
export function envelope(request: TripRequest, data: unknown) { return { data, meta: { requestId: request.requestId } }; }
export function result<T>(request: TripRequest, response: Response, value: { value: T; replayed: boolean }) { if (value.replayed) response.setHeader('Idempotent-Replay', 'true'); return envelope(request, value.value); }
const codes: Record<string, number> = {
  INVALID_REQUEST: 400, INVALID_CURSOR: 400, UNAUTHENTICATED: 401, INVALID_SERVICE_CREDENTIAL: 401, FORBIDDEN_ACTION: 403, RESOURCE_NOT_FOUND: 404,
  QUOTE_EXPIRED: 409, QUOTE_ALREADY_USED: 409, ACTIVE_TRIP_EXISTS: 409, DRIVER_HAS_ACTIVE_TRIP: 409, INVALID_TRANSITION: 409, VERSION_CONFLICT: 409,
  IDEMPOTENCY_KEY_REUSED: 409, EVENT_ID_REUSED: 409, TRIP_ALREADY_ASSIGNED: 409, TRIP_NOT_SEARCHING: 409, REQUEST_IN_PROGRESS: 503, DEPENDENCY_UNAVAILABLE: 503,
};
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<TripRequest>(); const response = host.switchToHttp().getResponse<Response>();
    let status = 500; let code = 'INTERNAL_ERROR';
    if (error instanceof DomainError) { code = error.code; status = codes[code] ?? 500; }
    else if (error instanceof HttpException) { status = error.getStatus(); code = status === 404 ? 'RESOURCE_NOT_FOUND' : status < 500 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR'; }
    else if (error && typeof error === 'object' && 'status' in error && [400, 413].includes(Number(error.status))) { status = Number(error.status); code = 'INVALID_REQUEST'; }
    if (status === 503) response.setHeader('Retry-After', '1');
    response.status(status).json({ error: { code, message: code, details: [] }, meta: { requestId: request.requestId } });
  }
}
