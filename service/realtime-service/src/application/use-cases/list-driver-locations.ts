import { LocationStore } from '../ports/location-store.port';
import { LocationPolicy } from '../../domain/policies/location.policy';
import { RealtimeError } from '../../domain/errors';
export interface LocationQuery { latitude: number; longitude: number; radiusMeters?: number; limit?: number; offset?: number }
export const MAX_LOCATIONS = 200;
// A page starts at most this far down the distance ranking, so one search reads at most 5000 rows.
export const MAX_OFFSET = 4800;
// Raw fresh locations for Matching (ADR-0001). Realtime applies no business rule here: Matching
// checks eligibility with Driver itself, so this endpoint has no Driver dependency. Matching asks for the next
// page (`nextOffset`) when every driver on a page is busy or ineligible, so a crowded area does not hide the
// free drivers just past the nearest `limit`.
export class ListDriverLocations {
  constructor(private readonly store: LocationStore, private readonly policy: LocationPolicy) {}
  async execute(input: LocationQuery) {
    const radiusMeters = input.radiusMeters ?? 2000, limit = input.limit ?? 50, offset = input.offset ?? 0;
    if (!Number.isFinite(input.latitude) || Math.abs(input.latitude) > 85.05112878 || !Number.isFinite(input.longitude) || Math.abs(input.longitude) > 180 ||
        !Number.isInteger(radiusMeters) || radiusMeters < 1 || radiusMeters > 2000 || !Number.isInteger(limit) || limit < 1 || limit > MAX_LOCATIONS ||
        !Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET)
      throw new RealtimeError('INVALID_REQUEST');
    const now = Date.now();
    const page = await this.store.nearest({ latitude: input.latitude, longitude: input.longitude, radiusMeters, limit, offset });
    const drivers = page.items
      .filter(item => this.policy.fresh(item, now))
      .map(item => ({ driverId: item.driverId, latitude: item.latitude, longitude: item.longitude, distanceMeters: item.distanceMeters, recordedAt: item.recordedAt }));
    // The next page must still start within MAX_OFFSET; past it the caller has seen as far as one search may read.
    const nextOffset = page.more && offset + limit <= MAX_OFFSET ? offset + limit : null;
    return { radiusMeters, drivers, nextOffset };
  }
}
