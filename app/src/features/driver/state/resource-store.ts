import type { DriverRuntime } from './runtime';
import { DriverResource } from './driver-resource';

// One store per authenticated shell (runtime/environment + driver + owner epoch).
export class DriverResourceStore {
  readonly intent;
  readonly active;
  readonly profile;
  readonly vehicles;
  private queries = new Map<string, DriverResource<unknown>>();
  constructor(private readonly runtime: DriverRuntime, private readonly owner: number) {
    this.intent = this.make(signal => runtime.driver.availability(signal));
    this.active = this.make(signal => runtime.trip.active(signal));
    this.profile = this.make(signal => runtime.driver.profile(signal));
    this.vehicles = this.make(signal => runtime.driver.vehicles(signal));
  }
  private owns = () => this.owner === this.runtime.session.getOwnerEpoch() && this.runtime.session.getSnapshot().usable;
  private make<T>(load: (signal: AbortSignal) => Promise<T>) { return new DriverResource(load, this.owns); }
  private query<T>(key: string, load: (signal: AbortSignal) => Promise<T>): DriverResource<T> {
    const cached = this.queries.get(key);
    if (cached) { this.queries.delete(key); this.queries.set(key, cached); return cached as DriverResource<T>; }
    // Bound cached pages/details, never evict a mounted consumer's resource.
    for (const [oldKey, resource] of this.queries) {
      if (this.queries.size < 20) break;
      if (!resource.observed && !resource.retained) { resource.clear(); this.queries.delete(oldKey); }
    }
    const resource = this.make(load);
    this.queries.set(key, resource as DriverResource<unknown>);
    return resource;
  }
  history(cursor?: string) {
    return this.query(`history:${JSON.stringify([20, cursor ?? null])}`, async signal => ({ ...(await this.runtime.trip.history(cursor, signal)), cursor }));
  }
  detail(id: string) { return this.query(`detail:${id.toLowerCase()}`, signal => this.runtime.trip.detail(id, signal)); }
  invalidateTrips = () => {
    this.intent.refresh();
    this.active.refresh();
    for (const resource of this.queries.values()) resource.refresh();
  };
  clear() {
    for (const resource of [this.intent, this.active, this.profile, this.vehicles, ...this.queries.values()]) resource.clear();
    this.queries.clear();
  }
}
