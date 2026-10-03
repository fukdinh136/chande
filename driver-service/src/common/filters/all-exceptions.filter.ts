import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

import { QueryFailedError } from 'typeorm';

@Catch()
export class AllExceptionsFilter
  implements ExceptionFilter
{
  catch(
    exception: unknown,
    host: ArgumentsHost,
  ) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    const timestamp = new Date().toISOString();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      interface ErrorResponse {
        message?: string | string[];
        error?: string;
        statusCode?: number;
      }

      const message =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : (exceptionResponse as ErrorResponse).message ?? exceptionResponse;

      response.status(status).json({
        success: false,
        statusCode: status,
        message,
        timestamp,
      });

      return;
    }

    /**
     * PostgreSQL unique constraint violation.
     */
    if (
      exception instanceof QueryFailedError &&
      (exception as any).driverError?.code === '23505'
    ) {
      response
        .status(HttpStatus.CONFLICT)
        .json({
          success: false,
          statusCode: HttpStatus.CONFLICT,
          message: 'Resource already exists',
          timestamp,
        });

      return;
    }

    response.status(
      HttpStatus.INTERNAL_SERVER_ERROR,
    ).json({
      success: false,
      statusCode:
        HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      timestamp,
    });
  }
}