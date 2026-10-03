import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export type VehicleType = 'CAR' | 'MOTORBIKE';

@Injectable()
export class RedisService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  private readonly carKey = 'drivers:geo:CAR';
  private readonly bikeKey = 'drivers:geo:MOTORBIKE';
  private readonly seenKey = 'drivers:locations:last_seen';

  private cleanupTimer?: ReturnType<typeof setInterval>;
  private cleaning = false;

  constructor(configService: ConfigService) {
    this.client = new Redis(
      configService.get<string>(
        'REDIS_URL',
        'redis://127.0.0.1:6379',
      ),
      {
        lazyConnect: true,
        connectTimeout: 5000,
        commandTimeout: 5000,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        autoResendUnfulfilledCommands: false,

        retryStrategy: (attempt) =>
          attempt <= 3 ? attempt * 500 : null,
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
      throw new Error('Cannot connect to Redis');
    }

    this.cleanupTimer = setInterval(() => {
      if (!this.cleaning) {
        void this.cleanupExpired();
      }
    }, 15000);

    this.logger.log('Redis ready');
  }

  async updateDriverLocation(
    driverId: string,
    lat: number,
    lng: number,
    vehicle: {
      id: string;
      vehicleType: VehicleType;
    },
  ): Promise<void> {
    const targetKey =
      vehicle.vehicleType === 'CAR'
        ? this.carKey
        : this.bikeKey;

    // Lua chạy nguyên tử:
    // - Bỏ tài xế khỏi các GEO cũ.
    // - Ghi vào GEO đúng loại xe.
    // - Cập nhật HASH và thời điểm nhận vị trí.
    await this.client.eval(
      `
      local t = redis.call('TIME')
      local now = tonumber(t[1]) * 1000
        + math.floor(tonumber(t[2]) / 1000)

      redis.call('ZREM', KEYS[1], ARGV[1])
      redis.call('ZREM', KEYS[2], ARGV[1])

      redis.call(
        'GEOADD',
        KEYS[5],
        ARGV[3],
        ARGV[2],
        ARGV[1]
      )

      redis.call(
        'HSET',
        KEYS[3],
        'status', 'ONLINE',
        'vehicle_id', ARGV[4],
        'vehicle_type', ARGV[5],
        'last_seen', tostring(now)
      )

      redis.call('EXPIRE', KEYS[3], 30)
      redis.call('ZADD', KEYS[4], now, ARGV[1])

      return 1
      `,
      5,
      this.carKey,
      this.bikeKey,
      `driver:${driverId}:state`,
      this.seenKey,
      targetKey,
      driverId,
      String(lat),
      String(lng),
      vehicle.id,
      vehicle.vehicleType,
    );
  }

  async removeDriverLocation(
    driverId: string,
  ): Promise<void> {
    await this.client.eval(
      `
      redis.call('ZREM', KEYS[1], ARGV[1])
      redis.call('ZREM', KEYS[2], ARGV[1])
      redis.call('ZREM', KEYS[3], ARGV[1])
      redis.call('DEL', KEYS[4])

      return 1
      `,
      4,
      this.carKey,
      this.bikeKey,
      this.seenKey,
      `driver:${driverId}:state`,
      driverId,
    );

    // Không xóa driver:<id>:lock.
    // Khóa đó thuộc luồng Matching.
  }

  private async cleanupExpired(): Promise<void> {
    this.cleaning = true;

    try {
      await this.client.eval(
        `
        local t = redis.call('TIME')
        local now = tonumber(t[1]) * 1000
          + math.floor(tonumber(t[2]) / 1000)

        local ids = redis.call(
          'ZRANGEBYSCORE',
          KEYS[3],
          '-inf',
          now - 30000,
          'LIMIT',
          0,
          1000
        )

        for _, id in ipairs(ids) do
          redis.call('ZREM', KEYS[1], id)
          redis.call('ZREM', KEYS[2], id)
          redis.call('ZREM', KEYS[3], id)
          redis.call('DEL', 'driver:' .. id .. ':state')
        end

        return #ids
        `,
        3,
        this.carKey,
        this.bikeKey,
        this.seenKey,
      );
    } catch (error) {
      this.logger.warn(
        error instanceof Error
          ? error.message
          : 'Location cleanup failed',
      );
    } finally {
      this.cleaning = false;
    }
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.client.disconnect();
  }
}