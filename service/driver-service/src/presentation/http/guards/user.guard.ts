import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Inject,
} from "@nestjs/common";
import {
  DriverContext,
  CONTEXT,
} from "../../../bootstrap/modules/driver-context";
import { DriverRequest } from "../http.types";
@Injectable()
export class UserGuard implements CanActivate {
  constructor(@Inject(CONTEXT) private readonly context: DriverContext) {}
  async canActivate(execution: ExecutionContext) {
    const req = execution.switchToHttp().getRequest<DriverRequest>();
    req.principal = await this.context.tokens.verify(
      req.header("Authorization"),
    );
    return true;
  }
}
