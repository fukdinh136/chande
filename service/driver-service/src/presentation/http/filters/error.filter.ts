import {
  Catch,
  ArgumentsHost,
  ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import { Response } from "express";
import { DriverError } from "../../../domain/value-objects/error";
import { DriverRequest } from "../http.types";
export const codes: Record<string, number> = {
  INVALID_REQUEST: 400,
  DRIVER_STATUS_MIGRATION_REQUIRED: 409,
  UNAUTHENTICATED: 401,
  AUTHENTICATION_FAILED: 401,
  INVALID_REFRESH_TOKEN: 401,
  INVALID_SERVICE_CREDENTIAL: 401,
  FORBIDDEN_ACTION: 403,
  RESOURCE_NOT_FOUND: 404,
  LICENSE_PLATE_CONFLICT: 409,
  LICENSE_NUMBER_CONFLICT: 409,
  VEHICLE_ACTIVE_CONSTRAINT: 409,
  VEHICLE_REQUIRED: 409,
  VEHICLE_INACTIVE: 409,
  PROFILE_INCOMPLETE: 409,
  DRIVER_MUST_BE_OFFLINE: 409,
  DRIVER_HAS_ACTIVE_TRIP: 409,
  VEHICLE_LIMIT_REACHED: 409,
  RATE_LIMITED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
};
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const req = host.switchToHttp().getRequest<DriverRequest>();
    const res = host.switchToHttp().getResponse<Response>();
    let code = "INTERNAL_ERROR";
    let status = 500;
    if (error instanceof DriverError) {
      code = error.code;
      status = codes[code] ?? 500;
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      code =
        status === 404
          ? "RESOURCE_NOT_FOUND"
          : status === 401
            ? "UNAUTHENTICATED"
            : status === 403
              ? "FORBIDDEN_ACTION"
              : status < 500
                ? "INVALID_REQUEST"
                : "INTERNAL_ERROR";
    } else if (error && typeof error === "object") {
      const pg = (
        error as {
          driverError?: { code?: string; constraint?: string; detail?: string };
        }
      ).driverError;
      if (pg?.code === "23505") {
        const field = `${pg.constraint ?? ""} ${pg.detail ?? ""}`;
        code = field.includes("license_number")
          ? "LICENSE_NUMBER_CONFLICT"
          : field.includes("license_plate")
            ? "LICENSE_PLATE_CONFLICT"
            : field.includes("active")
              ? "VEHICLE_ACTIVE_CONSTRAINT"
              : "LICENSE_PLATE_CONFLICT";
        status = 409;
      } else if (pg?.code?.startsWith("08") || pg?.code === "57P01") {
        code = "DEPENDENCY_UNAVAILABLE";
        status = 503;
      }
    }
    if (status === 429 || status === 503)
      res.setHeader("Retry-After", status === 429 ? "60" : "1");
    res.setHeader("Cache-Control", "no-store");
    res.status(status).json({
      error: { code, message: code, details: [] },
      meta: { requestId: req.requestId },
    });
  }
}
