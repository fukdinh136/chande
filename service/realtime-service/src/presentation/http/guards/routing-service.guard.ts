import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { requireServiceCredential } from './service-credential';
export const ROUTING_CREDENTIAL = Symbol('ROUTING_CREDENTIAL');
@Injectable()
export class RoutingServiceGuard implements CanActivate {
  constructor(@Inject(ROUTING_CREDENTIAL) private readonly credential: string) {}
  canActivate(context: ExecutionContext) {
    requireServiceCredential(context.switchToHttp().getRequest<Request>(), this.credential);
    return true;
  }
}
