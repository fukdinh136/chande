import { Injectable } from '@nestjs/common';
import { Socket } from 'socket.io';
import { DriverIdentity } from '../../../application/ports/token-verifier.port';
import { RealtimeError } from '../../../domain/errors';
export interface SocketSession { identity?: DriverIdentity; expiryTimer?: ReturnType<typeof setTimeout> }
/** Closes the socket when its JWT expires; called again whenever the driver renews the token on the live socket. */
export function armExpiry(state: SocketSession, close: () => void) {
  if (state.expiryTimer) clearTimeout(state.expiryTimer);
  state.expiryTimer = setTimeout(close, Math.min(2147483647, Math.max(1, state.identity!.expiresAt - Date.now())));
  state.expiryTimer.unref();
}
/**
 * B5: a driver sends a newer JWT on the open socket before the current one expires, so the socket is not closed and
 * every driver who logged in at the same time does not reconnect at the same time. Only the same driver, while the
 * current token is still valid; an expired socket must reconnect and authenticate again.
 */
export function renew(state: SocketSession, next: DriverIdentity) {
  const current = state.identity;
  if (!current || current.expiresAt <= Date.now()) throw new RealtimeError('UNAUTHENTICATED');
  if (next.driverId !== current.driverId) throw new RealtimeError('FORBIDDEN');
  if (next.expiresAt <= Date.now()) throw new RealtimeError('UNAUTHENTICATED');
  state.identity = next;
}
@Injectable()
export class DriverSocketGuard {
  actor(socket: Socket): DriverIdentity {
    const identity = (socket.data as SocketSession).identity;
    if (!identity || identity.expiresAt <= Date.now()) throw new RealtimeError('UNAUTHENTICATED');
    return identity;
  }
}
