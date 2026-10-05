import { Inject } from '@nestjs/common';
import { ConnectedSocket, MessageBody, OnGatewayInit, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { randomUUID } from 'node:crypto';
import { Namespace, Socket } from 'socket.io';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TOKEN_VERIFIER, TokenVerifier } from '../../application/ports/token-verifier.port';
import { UpdateLocation } from '../../application/use-cases/update-location';
import { RealtimeError } from '../../domain/errors';
import { LocationDto } from './dto/location.dto';
import { envelope, errorResponse } from '../http/response';
import { DriverSocketGuard, SocketSession } from './guards/driver-socket.guard';
@WebSocketGateway({ namespace: '/realtime', transports: ['websocket'], maxHttpBufferSize: 4096 })
export class LocationGateway implements OnGatewayInit, OnGatewayDisconnect {
  constructor(
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
    @Inject(UpdateLocation) private readonly update: UpdateLocation,
    private readonly guard: DriverSocketGuard,
  ) {}
  afterInit(server: Namespace) {
    server.use((socket, next) => {
      void (async () => {
        const auth: unknown = socket.handshake.auth;
        const token = auth && typeof auth === 'object' && 'token' in auth ? auth.token : undefined;
        if (typeof token !== 'string') throw new RealtimeError('UNAUTHENTICATED');
        const identity = await this.verifier.verify(token);
        const state = socket.data as SocketSession;
        state.identity = identity;
        // Guard checks expiry on every message too. Timer closes idle sockets at expiry.
        next();
      })().catch(error => {
        const code = error instanceof RealtimeError ? error.code : 'INTERNAL_ERROR';
        next(Object.assign(new Error(code), { data: { code } }));
      });
    });
    server.on('connection', socket => {
      const state = socket.data as SocketSession;
      state.expiryTimer = setTimeout(() => socket.disconnect(true), Math.min(2147483647, Math.max(1, state.identity!.expiresAt - Date.now())));
      state.expiryTimer.unref();
    });
  }
  handleDisconnect(socket: Socket) {
    const state = socket.data as SocketSession;
    if (state.expiryTimer) clearTimeout(state.expiryTimer);
    delete state.identity;
    // GPS expiry is independent of disconnect; never change Driver intent or Trip.
  }
  @SubscribeMessage('driver.location.update')
  async location(@ConnectedSocket() socket: Socket, @MessageBody() payload: unknown) {
    const requestId = randomUUID();
    try {
      const actor = this.guard.actor(socket);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new RealtimeError('INVALID_REQUEST');
      const dto = plainToInstance(LocationDto, payload);
      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true });
      if (errors.length) throw new RealtimeError('INVALID_REQUEST');
      return envelope(await this.update.execute(actor.driverId, dto), requestId);
    } catch (error) { return errorResponse(error, requestId); }
  }
}
