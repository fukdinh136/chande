import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { randomUUID } from 'node:crypto';

import {
  RedisService,
  type VehicleType,
} from '../redis/redis.service';

interface DriverProfile {
  id: string;
  status: 'ONLINE' | 'OFFLINE';
  accountStatus: 'PENDING' | 'ACTIVE' | 'BLOCKED';

  vehicles: {
    id: string;
    vehicleType: VehicleType;
    isActive: boolean;
  }[];
}

interface LocationPayload {
  driverId: string;
  lat: number;
  lng: number;
}

interface AuthenticatedSocket {
  id: string;
  token: string;
}

@WebSocketGateway()
export class LocationGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(LocationGateway.name);
  private readonly driverUrl: string;

  // Tuần tự hóa thao tác của một tài xế trong gateway instance này.
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly redis: RedisService,
    private readonly jwt: JwtService,
    configService: ConfigService,
  ) {
    this.driverUrl = configService
      .get<string>(
        'DRIVER_SERVICE_URL',
        'http://127.0.0.1:3001/api',
      )
      .replace(/\/$/, '');
  }

  private authenticate(
    client: Socket,
  ): AuthenticatedSocket {
    const token: unknown = client.handshake.auth?.token;

    if (typeof token !== 'string' || !token) {
      throw new Error('Missing token');
    }

    const payload = this.jwt.verify<{
      sub: string;
      exp: number;
    }>(token, {
      algorithms: ['HS256'],
    });

    if (
      typeof payload.sub !== 'string' ||
      !payload.sub ||
      !Number.isFinite(payload.exp)
    ) {
      throw new Error('Invalid token');
    }

    return {
      id: payload.sub,
      token,
    };
  }

  @WebSocketServer()
  server!: Server;

  async dispatchMockRide(body: unknown) {
    if (!isRecord(body) || !isRecord(body.rideDetails)) {
      throw new BadRequestException('Expected driverSocketId and rideDetails');
    }

    const { driverSocketId, rideDetails } = body;
    const { pickup, dropoff, estimatedFare } = rideDetails;

    if (
      typeof driverSocketId !== 'string' ||
      !driverSocketId.trim() ||
      driverSocketId.length > 200 ||
      typeof pickup !== 'string' ||
      !pickup.trim() ||
      pickup.length > 300 ||
      typeof dropoff !== 'string' ||
      !dropoff.trim() ||
      dropoff.length > 300 ||
      typeof estimatedFare !== 'number' ||
      !Number.isFinite(estimatedFare) ||
      estimatedFare < 0
    ) {
      throw new BadRequestException('Invalid ride request');
    }

    const client = this.server.sockets.sockets.get(driverSocketId);

    if (!client?.connected) {
      throw new NotFoundException('Driver socket is not connected');
    }

    const driverId = await this.verifyMockDriver(client);

    // Kiểm tra trạng thái thực tế từ Driver Service.
    let response: Response;

    try {
      const baseUrl = (
        process.env.DRIVER_SERVICE_URL ?? 'http://127.0.0.1:3001/api'
      ).replace(/\/$/, '');

      response = await fetch(`${baseUrl}/drivers/me`, {
        headers: {
          Authorization: `Bearer ${client.handshake.auth.token}`,
        },
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      throw new ServiceUnavailableException('Cannot reach driver-service');
    }

    if (response.status === 401) {
      throw new UnauthorizedException('Driver token has expired');
    }

    if (!response.ok) {
      throw new ServiceUnavailableException('Cannot load driver profile');
    }

    const profile: unknown = await response.json();

    if (
      !isRecord(profile) ||
      profile.id !== driverId ||
      profile.accountStatus !== 'ACTIVE' ||
      profile.status !== 'ONLINE'
    ) {
      throw new ConflictException('Driver must be ONLINE');
    }

    // Kiểm tra lại sau các thao tác bất đồng bộ.
    if (!client.connected) {
      throw new NotFoundException('Driver disconnected');
    }

    const previous = client.data.mockOffer as MockOffer | undefined;

    if (
      previous?.status === 'ACCEPTED' ||
      (previous?.status === 'PENDING' &&
        previous.ride.expiresAt > Date.now())
    ) {
      throw new ConflictException('Driver already has a ride or pending offer');
    }

    const ride: MockRide = {
      rideId: randomUUID(),
      pickup: pickup.trim(),
      dropoff: dropoff.trim(),
      estimatedFare,
      expiresAt: Date.now() + 15_000,
    };

    client.data.mockOffer = {
      ride,
      driverId,
      status: 'PENDING',
    } satisfies MockOffer;

    // Socket.IO tự tạo room có tên bằng socket ID.
    this.server.to(driverSocketId).emit('new_ride_request', ride);

    // "emitted" chỉ có nghĩa server đã phát event, chưa chứng minh app đã nhận.
    return { emitted: true, ...ride };
  }

  @SubscribeMessage('accept_ride')
  async acceptRide(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): Promise<RideAck> {
    return this.respondToMockRide(client, payload, 'ACCEPTED');
  }

  @SubscribeMessage('reject_ride')
  async rejectRide(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): Promise<RideAck> {
    return this.respondToMockRide(client, payload, 'REJECTED');
  }

  private async verifyMockDriver(client: Socket): Promise<string> {
    const token: unknown = client.handshake.auth?.token;

    if (typeof token !== 'string') {
      throw new UnauthorizedException('Missing token');
    }

    try {
      const claims = await this.jwt.verifyAsync<{
        sub: string;
        exp: number;
      }>(token, { algorithms: ['HS256'] });

      if (
        typeof claims.sub !== 'string' ||
        !claims.sub ||
        typeof claims.exp !== 'number'
      ) {
        throw new Error('Invalid token');
      }

      return claims.sub;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private async respondToMockRide(
    client: Socket,
    payload: unknown,
    decision: 'ACCEPTED' | 'REJECTED',
  ): Promise<RideAck> {
    if (!isRecord(payload) || typeof payload.rideId !== 'string') {
      return {
        success: false,
        code: 'INVALID_PAYLOAD',
        message: 'Expected rideId',
      };
    }

    let driverId: string;

    try {
      driverId = await this.verifyMockDriver(client);
    } catch {
      return {
        success: false,
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired token',
      };
    }

    const offer = client.data.mockOffer as MockOffer | undefined;

    if (
      !offer ||
      offer.driverId !== driverId ||
      offer.ride.rideId !== payload.rideId
    ) {
      return {
        success: false,
        code: 'RIDE_NOT_FOUND',
        message: 'Ride does not belong to this socket',
      };
    }

    // Cho phép retry cùng một phản hồi mà không xử lý lại.
    if (offer.status === decision) {
      return {
        success: true,
        rideId: offer.ride.rideId,
        status: decision,
      };
    }

    if (offer.status !== 'PENDING') {
      return {
        success: false,
        code: 'ALREADY_RESPONDED',
        message: 'Ride already has a response',
      };
    }

    if (decision === 'ACCEPTED' && Date.now() >= offer.ride.expiresAt) {
      return {
        success: false,
        code: 'RIDE_EXPIRED',
        message: 'Ride request has expired',
      };
    }

    offer.status = decision;

    console.log('[mock ride response]', {
      driverId,
      socketId: client.id,
      rideId: offer.ride.rideId,
      decision,
      reason:
        decision === 'REJECTED' && typeof payload.reason === 'string'
          ? payload.reason.slice(0, 50)
          : undefined,
    });

    return {
      success: true,
      rideId: offer.ride.rideId,
      status: decision,
    };
  }

  finishMockRide(driverId: string, tripId: string): void {
    for (const client of this.server.sockets.sockets.values()) {
      const offer = client.data.mockOffer as MockOffer | undefined;

      if (
        offer?.driverId === driverId &&
        offer.ride.rideId === tripId &&
        offer.status === 'ACCEPTED'
      ) {
        delete client.data.mockOffer;
      }
    }
  }

  handleConnection(client: Socket): void {
    try {
      this.authenticate(client);
    } catch {
      client.emit('auth_error', {
        message: 'Missing, invalid, or expired access token',
      });

      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(
      `Socket disconnected: ${client.id}`,
    );

    // Không xóa ngay vì tài xế có thể còn socket khác.
    // Worker Redis dọn vị trí nếu không còn cập nhật.
  }

  private async getProfile(
    token: string,
    driverId: string,
  ): Promise<DriverProfile> {
    const response = await fetch(
      `${this.driverUrl}/drivers/me`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(3000),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Driver lookup failed: HTTP ${response.status}`,
      );
    }

    const profile =
      (await response.json()) as DriverProfile;

    if (
      profile.id !== driverId ||
      !Array.isArray(profile.vehicles)
    ) {
      throw new Error('Invalid driver profile');
    }

    return profile;
  }

  private async serial<T>(
    driverId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous =
      this.queues.get(driverId) ?? Promise.resolve();

    const job = previous.then(action);

    const tail = job.then(
      () => undefined,
      () => undefined,
    );

    this.queues.set(driverId, tail);

    try {
      return await job;
    } finally {
      if (this.queues.get(driverId) === tail) {
        this.queues.delete(driverId);
      }
    }
  }

  private isValidLocation(
    payload: unknown,
  ): payload is LocationPayload {
    if (
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload)
    ) {
      return false;
    }

    const value = payload as Record<string, unknown>;

    return (
      typeof value.driverId === 'string' &&
      value.driverId.length > 0 &&
      typeof value.lat === 'number' &&
      Number.isFinite(value.lat) &&
      Math.abs(value.lat) <= 85.05112878 &&
      typeof value.lng === 'number' &&
      Number.isFinite(value.lng) &&
      Math.abs(value.lng) <= 180
    );
  }

  @SubscribeMessage('driver_location_update')
  async update(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ) {
    let auth: AuthenticatedSocket;

    try {
      auth = this.authenticate(client);
    } catch {
      return {
        success: false,
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired JWT',
      };
    }

    if (!this.isValidLocation(payload)) {
      return {
        success: false,
        code: 'INVALID_PAYLOAD',
        message: 'Invalid driverId or coordinates',
      };
    }

    if (payload.driverId !== auth.id) {
      return {
        success: false,
        code: 'FORBIDDEN',
        message: 'Cannot update another driver location',
      };
    }

    return this.serial(auth.id, async () => {
      try {
        const profile = await this.getProfile(
          auth.token,
          auth.id,
        );

        if (
          profile.accountStatus !== 'ACTIVE' ||
          profile.status !== 'ONLINE'
        ) {
          await this.redis.removeDriverLocation(auth.id);

          return {
            success: false,
            code: 'DRIVER_OFFLINE',
            message: 'Driver must be ONLINE',
          };
        }

        const activeVehicles = profile.vehicles.filter(
          (vehicle) => vehicle.isActive,
        );

        if (
          activeVehicles.length !== 1 ||
          !['BIKE', 'CAR_4', 'CAR_7'].includes(
            activeVehicles[0].vehicleType,
          )
        ) {
          await this.redis.removeDriverLocation(auth.id);

          return {
            success: false,
            code: 'NO_ACTIVE_VEHICLE',
            message: 'Select exactly one active vehicle',
          };
        }

        await this.redis.updateDriverLocation(
          auth.id,
          payload.lat,
          payload.lng,
          activeVehicles[0],
        );

        return {
          success: true,
        };
      } catch (error) {
        this.logger.warn(
          error instanceof Error
            ? error.message
            : 'Location update failed',
        );

        return {
          success: false,
          code: 'LOCATION_UPDATE_FAILED',
          message: 'Driver lookup or location storage unavailable',
        };
      }
    });
  }

  @SubscribeMessage('driver_offline')
  async offline(
    @ConnectedSocket() client: Socket,
  ) {
    let auth: AuthenticatedSocket;

    try {
      auth = this.authenticate(client);
    } catch {
      return {
        success: false,
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired JWT',
      };
    }

    return this.serial(auth.id, async () => {
      try {
        const profile = await this.getProfile(
          auth.token,
          auth.id,
        );

        if (profile.status !== 'OFFLINE') {
          return {
            success: false,
            code: 'STATUS_NOT_OFFLINE',
            message: 'Update REST status before clearing location',
          };
        }

        await this.redis.removeDriverLocation(auth.id);

        return {
          success: true,
        };
      } catch {
        return {
          success: false,
          code: 'LOCATION_REMOVE_FAILED',
          message: 'Could not clear location',
        };
      }
    });
  }
}

interface MockRide {
  rideId: string;
  pickup: string;
  dropoff: string;
  estimatedFare: number;
  expiresAt: number;
}

interface MockOffer {
  ride: MockRide;
  driverId: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
}

type RideAck =
  | {
      success: true;
      rideId: string;
      status: 'ACCEPTED' | 'REJECTED';
    }
  | {
      success: false;
      code: string;
      message: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}