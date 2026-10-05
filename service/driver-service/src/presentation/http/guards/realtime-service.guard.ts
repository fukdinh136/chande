import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { DriverError } from '../../../domain/value-objects/error';
import { CONTEXT, DriverContext } from '../../../bootstrap/modules/driver-context';
import { DriverRequest } from '../http.types';
@Injectable()
export class RealtimeServiceGuard implements CanActivate {
  constructor(@Inject(CONTEXT) private readonly context: DriverContext) {}
  canActivate(execution: ExecutionContext) {
    const expected = this.context.config.realtimeToken;
    const actual = execution.switchToHttp().getRequest<DriverRequest>().header('X-Service-Token') ?? '';
    const digest = (value: string) => createHash('sha256').update(value).digest();
    if (!expected || !actual || actual.length > 4096 || !timingSafeEqual(digest(actual), digest(expected)))
      throw new DriverError('INVALID_SERVICE_CREDENTIAL');
    return true;
  }
}
