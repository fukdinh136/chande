import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Request } from 'express';
import { RealtimeError } from '../../../domain/errors';
export const ROUTING_CREDENTIAL = Symbol('ROUTING_CREDENTIAL');
@Injectable()
export class RoutingServiceGuard implements CanActivate {
  constructor(@Inject(ROUTING_CREDENTIAL) private readonly credential: string) {}
  canActivate(context: ExecutionContext) {
    const actual = context.switchToHttp().getRequest<Request>().header('X-Service-Token') ?? '';
    const digest = (value: string) => createHash('sha256').update(value).digest();
    if (!actual || actual.length > 4096 || !timingSafeEqual(digest(actual), digest(this.credential)))
      throw new RealtimeError('INVALID_SERVICE_CREDENTIAL');
    return true;
  }
}
