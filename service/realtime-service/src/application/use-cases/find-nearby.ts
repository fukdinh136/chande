import { EligibilityProvider } from '../ports/eligibility-provider.port';
import { LocationStore } from '../ports/location-store.port';
import { LocationPolicy } from '../../domain/policies/location.policy';
import { NearbyPolicy, NearbyQuery } from '../../domain/policies/nearby.policy';
import { RealtimeError } from '../../domain/errors';
export class FindNearby {
  constructor(
    private readonly store: LocationStore,
    private readonly eligibility: EligibilityProvider,
    private readonly locationPolicy: LocationPolicy,
    private readonly nearbyPolicy: NearbyPolicy,
  ) {}
  async execute(input: NearbyQuery) {
    const query = this.nearbyPolicy.validate(input);
    const candidates = (await this.store.nearby(query)).filter(item => this.locationPolicy.fresh(item, Date.now()));
    if (!candidates.length) return { radiusMeters: query.radiusMeters, drivers: [] };
    const decisions = await this.eligibility.find(candidates.map(item => item.driverId), query.vehicleType);
    const byId = new Map(decisions.map(item => [item.driverId, item]));
    if (decisions.length !== candidates.length || candidates.some(item => !byId.has(item.driverId)))
      throw new RealtimeError('DEPENDENCY_UNAVAILABLE');
    // No lease: Driver's answer is a snapshot. Matching must check again at reservation/assignment.
    // Read locations again after HTTP so an expired or moved location is not returned from the first scan.
    const latest = await this.store.nearby(query);
    const drivers = [];
    for (const location of latest) {
      if (!this.locationPolicy.fresh(location, Date.now())) continue;
      const decision = byId.get(location.driverId);
      if (!decision) continue; // New arrivals have not been checked by Driver in this request.
      if (!decision.availabilityKnown) throw new RealtimeError('ELIGIBILITY_UNDETERMINED');
      if (!decision.eligible || !decision.vehicleType) continue;
      if (query.vehicleType && decision.vehicleType !== query.vehicleType) continue;
      drivers.push({
        driverId: location.driverId, vehicleType: decision.vehicleType,
        latitude: location.latitude, longitude: location.longitude,
        distanceMeters: location.distanceMeters, recordedAt: location.recordedAt,
      });
    }
    drivers.sort((a, b) => a.distanceMeters - b.distanceMeters || a.driverId.localeCompare(b.driverId));
    return { radiusMeters: query.radiusMeters, drivers: drivers.slice(0, this.nearbyPolicy.maximumResults) };
  }
}
