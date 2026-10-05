import Redis from 'ioredis';
import { LocationStore } from '../../application/ports/location-store.port';
import { LocationInput, LocationReceipt, NearbyLocation } from '../../domain/location/driver-location';
import { NearbyQuery } from '../../domain/policies/nearby.policy';
import { RealtimeError } from '../../domain/errors';
import { UPDATE_LOCATION, FIND_NEARBY, CLEANUP_STALE } from './location.scripts';
const KEYS = ['geo', 'expiry', 'meta', 'order', 'order-expiry'].map(name => `realtime:{gps}:${name}`);
interface Metadata extends LocationInput { driverId: string; receivedAtMs: number; distanceMeters: number }
export class RedisLocationRepository implements LocationStore {
  constructor(
    private readonly redis: Redis,
    private readonly freshnessMs: number,
    private readonly futureMs: number,
    private readonly orderRetentionMs: number,
    private readonly minIntervalMs: number,
    private readonly cleanupBatch: number,
    private readonly maxCandidates: number,
  ) {}
  private async command<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) { if (error instanceof RealtimeError) throw error; throw new RealtimeError('DEPENDENCY_UNAVAILABLE'); }
  }
  update(driverId: string, location: LocationInput): Promise<LocationReceipt> {
    return this.command(async () => {
      const reply = await this.redis.eval(UPDATE_LOCATION, KEYS.length, ...KEYS, driverId,
        Date.parse(location.recordedAt), location.latitude, location.longitude, location.accuracy,
        location.recordedAt, this.freshnessMs, this.futureMs, this.orderRetentionMs, this.minIntervalMs) as string[];
      const disposition = reply[0];
      if (disposition !== 'STORED' && disposition !== 'DUPLICATE') throw new RealtimeError(disposition);
      return { accepted: true, disposition, recordedAt: location.recordedAt, receivedAt: new Date(Number(reply[1])).toISOString() };
    });
  }
  nearby(query: NearbyQuery & { radiusMeters: number }): Promise<NearbyLocation[]> {
    return this.command(async () => {
      const values = await this.redis.eval(FIND_NEARBY, 3, ...KEYS.slice(0, 3),
        query.latitude, query.longitude, query.radiusMeters, this.maxCandidates) as string[];
      if (values[0] === 'SEARCH_CAPACITY_EXCEEDED') throw new RealtimeError(values[0]);
      return values.map(value => {
        const item = JSON.parse(value) as Metadata;
        return { ...item, receivedAt: new Date(item.receivedAtMs).toISOString() };
      });
    });
  }
  cleanup() {
    return this.command(async () => Number(await this.redis.eval(CLEANUP_STALE, KEYS.length, ...KEYS, this.cleanupBatch)));
  }
  async ready() { try { return await this.redis.ping() === 'PONG'; } catch { return false; } }
}
