import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Inject,
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { DriverError } from "../../../domain/value-objects/error";
import {
  DriverContext,
  CONTEXT,
} from "../../../bootstrap/modules/driver-context";
import { DriverRequest } from "../http.types";
@Injectable()
export class ServiceGuard implements CanActivate {
  constructor(@Inject(CONTEXT) private readonly context: DriverContext) {}
  canActivate(execution: ExecutionContext) {
    const actual = Buffer.from(
      execution
        .switchToHttp()
        .getRequest<DriverRequest>()
        .header("X-Service-Token") ?? "",
    );
    const expected = Buffer.from(this.context.config.matchingToken);
    if (
      !expected.length ||
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    )
      throw new DriverError("INVALID_SERVICE_CREDENTIAL");
    return true;
  }
}
