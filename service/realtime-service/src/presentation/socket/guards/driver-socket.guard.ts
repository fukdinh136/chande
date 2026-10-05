import { Injectable } from '@nestjs/common';
import { Socket } from 'socket.io';
import { DriverIdentity } from '../../../application/ports/token-verifier.port';
import { RealtimeError } from '../../../domain/errors';
export interface SocketSession { identity?: DriverIdentity; expiryTimer?: ReturnType<typeof setTimeout> }
@Injectable()
export class DriverSocketGuard {
  actor(socket: Socket): DriverIdentity {
    const identity = (socket.data as SocketSession).identity;
    if (!identity || identity.expiresAt <= Date.now()) throw new RealtimeError('UNAUTHENTICATED');
    return identity;
  }
}
