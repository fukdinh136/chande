import { LocationStore } from '../ports/location-store.port';
import { LocationPolicy } from '../../domain/policies/location.policy';
import { RealtimeError } from '../../domain/errors';
export interface LocationQuery { latitude: number; longitude: number; radiusMeters?: number; limit?: number }
export const MAX_LOCATIONS = 200;
// Raw fresh locations for Matching (ADR-0001). Realtime applies no business rule here: Matching
// checks eligibility with Driver itself, so this endpoint has no Driver dependency.
export class ListDriverLocations {
  constructor(private readonly store: LocationStore, private readonly policy: LocationPolicy) {}
  async execute(input: LocationQuery) {
    const radiusMeters = input.radiusMeters ?? 2000, limit = input.limit ?? 50;
    if (!Number.isFinite(input.latitude) || Math.abs(input.latitude) > 85.05112878 || !Number.isFinite(input.longitude) || Math.abs(input.longitude) > 180 ||
        !Number.isInteger(radiusMeters) || radiusMeters < 1 || radiusMeters > 2000 || !Number.isInteger(limit) || limit < 1 || limit > MAX_LOCATIONS)
      throw new RealtimeError('INVALID_REQUEST');
    const now = Date.now();
    const drivers = (await this.store.nearest({ latitude: input.latitude, longitude: input.longitude, radiusMeters, limit }))
      .filter(item => this.policy.fresh(item, now))
      .map(item => ({ driverId: item.driverId, latitude: item.latitude, longitude: item.longitude, distanceMeters: item.distanceMeters, recordedAt: item.recordedAt }));
    return { radiusMeters, drivers };
  }
}
