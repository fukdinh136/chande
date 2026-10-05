import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export type VehicleType = 'BIKE' | 'CAR_4' | 'CAR_7';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  private readonly geoKeys = [
    'drivers:geo:BIKE',
    'drivers:geo:CAR_4',
    'drivers:geo:CAR_7',
  ];

  private readonly seenKey = 'drivers:locations:last_seen';
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private cleaning = false;

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
      throw new Error('Cannot connect to Redis');
    }

    this.cleanupTimer = setInterval(() => {
      if (!this.cleaning) void this.cleanupExpired();
    }, 15_000);
  }

  async updateDriverLocation(
    driverId: string,
    lat: number,
    lng: number,
    vehicle: { id: string; vehicleType: VehicleType },
  ): Promise<void> {
    if (!['BIKE', 'CAR_4', 'CAR_7'].includes(vehicle.vehicleType)) {
      throw new Error('Unsupported vehicle type');
    }

    const result = await this.client.eval(
      `
        -- Không ghi lại vị trí nếu REST vừa chuyển tài xế Offline.
        if redis.call('GET', KEYS[7]) ~= 'ONLINE' then
          return 0
        end

        local t = redis.call('TIME')
        local now = tonumber(t[1]) * 1000
          + math.floor(tonumber(t[2]) / 1000)

        for i = 1, 3 do
          redis.call('ZREM', KEYS[i], ARGV[1])
        end

        redis.call('GEOADD', KEYS[6], ARGV[3], ARGV[2], ARGV[1])
        redis.call(
          'HSET', KEYS[4],
          'status', 'ONLINE',
          'vehicle_id', ARGV[4],
          'vehicle_type', ARGV[5],
          'last_seen', tostring(now)
        )
        redis.call('EXPIRE', KEYS[4], 30)
        redis.call('ZADD', KEYS[5], now, ARGV[1])
        return 1
      `,
      7,
      ...this.geoKeys,
      `driver:${driverId}:state`,
      this.seenKey,
      `drivers:geo:${vehicle.vehicleType}`,
      `driver:${driverId}:availability`,
      driverId,
      String(lat),
      String(lng),
      vehicle.id,
      vehicle.vehicleType,
    );

    if (result !== 1) {
      throw new Error('Driver is no longer ONLINE');
    }
  }

  async removeDriverLocation(driverId: string): Promise<void> {
    await this.client.eval(
      `
        for i = 1, 3 do
          redis.call('ZREM', KEYS[i], ARGV[1])
        end
        redis.call('ZREM', KEYS[4], ARGV[1])
        redis.call('DEL', KEYS[5])
        return 1
      `,
      5,
      ...this.geoKeys,
      this.seenKey,
      `driver:${driverId}:state`,
      driverId,
    );
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
            'ZRANGEBYSCORE', KEYS[4],
            '-inf', now - 30000,
            'LIMIT', 0, 1000
          )

          for _, id in ipairs(ids) do
            for i = 1, 3 do
              redis.call('ZREM', KEYS[i], id)
            end
            redis.call('ZREM', KEYS[4], id)
            redis.call('DEL', 'driver:' .. id .. ':state')
          end

          return #ids
        `,
        4,
        ...this.geoKeys,
        this.seenKey,
      );
    } catch (cause) {
      this.logger.warn(
        cause instanceof Error ? cause.message : 'Cleanup failed',
      );
    } finally {
      this.cleaning = false;
    }
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.client.disconnect();
  }
}