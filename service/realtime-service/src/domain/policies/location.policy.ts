import { RealtimeError } from '../errors';
import { LocationInput } from '../location/driver-location';
export class LocationPolicy {
  constructor(
    readonly freshnessMs: number,
    readonly maxFutureMs: number,
    readonly maxAccuracyMeters: number,
  ) {}
  validate(location: LocationInput, now: number): void {
    if (!Number.isFinite(location.latitude) || Math.abs(location.latitude) > 85.05112878 ||
        !Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180 ||
        !Number.isFinite(location.accuracy) || location.accuracy < 0 || location.accuracy > this.maxAccuracyMeters)
      throw new RealtimeError('INVALID_REQUEST');
    const recorded = Date.parse(location.recordedAt);
    if (!Number.isFinite(recorded)) throw new RealtimeError('INVALID_REQUEST');
    if (recorded > now + this.maxFutureMs) throw new RealtimeError('LOCATION_IN_FUTURE');
    if (now - recorded >= this.freshnessMs) throw new RealtimeError('LOCATION_STALE');
  }
  fresh(location: { recordedAt: string; receivedAt: string }, now: number): boolean {
    const recorded = Date.parse(location.recordedAt), received = Date.parse(location.receivedAt);
    return Number.isFinite(recorded) && Number.isFinite(received) &&
      recorded <= now + this.maxFutureMs && received <= now + this.maxFutureMs &&
      now - recorded < this.freshnessMs && now - received < this.freshnessMs;
  }
}
