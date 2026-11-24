import { createHash, timingSafeEqual } from 'node:crypto';
import { Request } from 'express';
import { RealtimeError } from '../../../domain/errors';
/** Constant-time check of X-Service-Token. An empty configured credential rejects every caller. */
export function requireServiceCredential(request: Request, credential: string) {
  const actual = request.header('X-Service-Token') ?? '';
  const digest = (value: string) => createHash('sha256').update(value).digest();
  if (!credential || !actual || actual.length > 4096 || !timingSafeEqual(digest(actual), digest(credential)))
    throw new RealtimeError('INVALID_SERVICE_CREDENTIAL');
}
