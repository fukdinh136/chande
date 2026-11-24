import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { requireServiceCredential } from './service-credential';
export const MATCHING_LOCATION_CREDENTIAL = Symbol('MATCHING_LOCATION_CREDENTIAL');
@Injectable()
export class MatchingServiceGuard implements CanActivate {
  constructor(@Inject(MATCHING_LOCATION_CREDENTIAL) private readonly credential: string) {}
  canActivate(context: ExecutionContext) {
    requireServiceCredential(context.switchToHttp().getRequest<Request>(), this.credential);
    return true;
  }
}
