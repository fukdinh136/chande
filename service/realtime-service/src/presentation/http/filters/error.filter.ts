import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Response } from 'express';
import { RealtimeError } from '../../../domain/errors';
import { errorResponse, RealtimeRequest, statusFor } from '../response';
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const request = host.switchToHttp().getRequest<RealtimeRequest>();
    const response = host.switchToHttp().getResponse<Response>();
    const mapped = error instanceof HttpException ? new RealtimeError(
      error.getStatus() === 404 ? 'RESOURCE_NOT_FOUND' : error.getStatus() < 500 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR',
    ) : error;
    const body = errorResponse(mapped, request.requestId);
    const status = error instanceof HttpException ? error.getStatus() : statusFor(body.error.code);
    if (status === 503) response.setHeader('Retry-After', '1');
    response.status(status).json(body);
  }
}
