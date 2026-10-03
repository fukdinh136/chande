import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';

import {
  RedisService,
  type VehicleType,
} from '../redis/redis.service';

interface DriverProfile {
  id: string;
  status: 'ONLINE' | 'OFFLINE';

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

        if (profile.status !== 'ONLINE') {
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
          !['CAR', 'MOTORBIKE'].includes(
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