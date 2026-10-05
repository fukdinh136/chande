import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export type AvailabilityStatus = 'ONLINE' | 'OFFLINE';

@Injectable()
export class AvailabilityService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AvailabilityService.name);
  private readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis(
      config.get<string>('REDIS_URL', 'redis://127.0.0.1:6379'),
      {
        lazyConnect: true,
        connectTimeout: 5000,
        commandTimeout: 5000,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        autoResendUnfulfilledCommands: false,
      },
    );

    this.client.on('error', (error: Error) => {
      this.logger.error(error.message);
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
      await this.client.ping();
    } catch {
      this.client.disconnect();
      throw new Error('Cannot connect to availability Redis');
    }
  }

  async get(driverId: string): Promise<AvailabilityStatus> {
    try {
      const value = await this.client.get(
        `driver:${driverId}:availability`,
      );

      return value === 'ONLINE' ? 'ONLINE' : 'OFFLINE';
    } catch {
      throw new ServiceUnavailableException(
        'Driver availability storage is unavailable',
      );
    }
  }

  async set(
    driverId: string,
    status: AvailabilityStatus,
  ): Promise<void> {
    try {
      if (status === 'ONLINE') {
        await this.client.set(
          `driver:${driverId}:availability`,
          'ONLINE',
        );
        return;
      }

      // Chuyển Offline và dọn vị trí trong cùng thao tác Redis.
      // Không xóa khóa matching driver:{id}:lock.
      await this.client.eval(
        `
          redis.call('DEL', KEYS[1])
          redis.call('ZREM', KEYS[2], ARGV[1])
          redis.call('ZREM', KEYS[3], ARGV[1])
          redis.call('ZREM', KEYS[4], ARGV[1])
          redis.call('ZREM', KEYS[5], ARGV[1])
          redis.call('DEL', KEYS[6])
          return 1
        `,
        6,
        `driver:${driverId}:availability`,
        'drivers:geo:BIKE',
        'drivers:geo:CAR_4',
        'drivers:geo:CAR_7',
        'drivers:locations:last_seen',
        `driver:${driverId}:state`,
        driverId,
      );
    } catch {
      throw new ServiceUnavailableException(
        'Cannot update driver availability',
      );
    }
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}