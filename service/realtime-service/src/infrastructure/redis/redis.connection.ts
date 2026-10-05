import Redis from 'ioredis';
export class RedisConnection {
  readonly client: Redis;
  constructor(url: string, timeoutMs: number) {
    this.client = new Redis(url, {
      lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1,
      commandTimeout: timeoutMs, connectTimeout: timeoutMs,
      retryStrategy: attempts => Math.min(250 * attempts, 2000),
    });
    this.client.on('error', () => {}); // Never log connection URLs or GPS.
  }
  async onModuleInit() { await this.client.connect().catch(() => {}); }
  onModuleDestroy() { this.client.disconnect(); }
}
