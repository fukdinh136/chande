import { Store } from '../../ports/unit-of-work.port';
import { State } from '../../ports/state.port';
import { DriverError } from '../../../domain/value-objects/error';
import { eligibilityReasons } from '../../../domain/policies/eligibility.policy';
export interface BatchEligibility {
  driverId: string;
  profileEligible: boolean;
  eligible: boolean;
  availabilityKnown: boolean;
  vehicleType: string | null;
  operationalStatus: string;
  reasons: string[];
}
export class BatchEligibilityUseCase {
  constructor(private readonly store: Store, private readonly state: State, private readonly types: readonly string[]) {}
  async execute(driverIds: readonly string[], type?: string) {
    const ids = driverIds.map(id => id.toLowerCase());
    if (!driverIds.length || driverIds.length > 100 || new Set(ids).size !== driverIds.length ||
        driverIds.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) ||
        (type !== undefined && !this.types.includes(type))) throw new DriverError('INVALID_REQUEST');
    const items: BatchEligibility[] = new Array(ids.length);
    let cursor = 0;
    const results = await Promise.allSettled(Array.from({ length: Math.min(4, ids.length) }, async () => {
      while (cursor < ids.length) { const index = cursor++; items[index] = await this.one(ids[index], type); }
    }));
    if (results.some(result => result.status === 'rejected')) throw new DriverError('DEPENDENCY_UNAVAILABLE');
    return { items };
  }
  private one(id: string, type?: string): Promise<BatchEligibility> {
    return this.store.coordinate(id, async () => {
      const rejected = (reason: string): BatchEligibility => ({ driverId: id, profileEligible: false, eligible: false,
        availabilityKnown: true, vehicleType: null, operationalStatus: 'UNKNOWN', reasons: [reason] });
      try {
        const driver = await this.store.read(repo => repo.driver(id));
        if (!driver) return rejected('DRIVER_NOT_FOUND');
        // Unknown legacy status never authorizes a driver, even when cached AVAILABLE.
        if (driver.desiredStatus !== 'ONLINE' && driver.desiredStatus !== 'OFFLINE') return rejected('DRIVER_STATUS_MIGRATION_REQUIRED');
        if (driver.desiredStatus === 'OFFLINE') return rejected('DRIVER_OFFLINE');
        const cache = await this.state.read(id);
        const vehicle = cache.vehicleId ? await this.store.read(repo => repo.vehicle(id, cache.vehicleId!)) : null;
        const reasons = eligibilityReasons(driver, vehicle, type);
        const profileEligible = reasons.length === 0;
        // Existing projection may be UNKNOWN after ONLINE/cache loss. GPS does not make it AVAILABLE.
        const availabilityKnown = !profileEligible || (cache.projectedStatus === 'ONLINE' && ['AVAILABLE', 'BUSY', 'OFFLINE'].includes(cache.realtimeStatus));
        if (profileEligible && !availabilityKnown) reasons.push('AVAILABILITY_UNDETERMINED');
        else if (profileEligible && cache.realtimeStatus !== 'AVAILABLE') reasons.push(cache.realtimeStatus === 'BUSY' ? 'DRIVER_BUSY' : 'OPERATIONALLY_OFFLINE');
        return { driverId: id, profileEligible, eligible: profileEligible && availabilityKnown && cache.realtimeStatus === 'AVAILABLE',
          availabilityKnown, vehicleType: vehicle?.vehicleType ?? null, operationalStatus: cache.realtimeStatus, reasons };
      } catch (error) {
        if (error instanceof DriverError && error.code === 'DRIVER_STATUS_MIGRATION_REQUIRED') return rejected(error.code);
        throw error;
      }
    });
  }
}
