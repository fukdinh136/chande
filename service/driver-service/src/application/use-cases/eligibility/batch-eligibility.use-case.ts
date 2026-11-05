import { Store } from '../../ports/unit-of-work.port';
import { Projection, State, StateSnapshot } from '../../ports/state.port';
import { DriverError } from '../../../domain/value-objects/error';
import { eligibilityReasons } from '../../../domain/policies/eligibility.policy';
import { Occupancy } from '../../ports/occupancy.port';
import { Driver } from '../../../domain/driver/driver';
import { Vehicle } from '../../../domain/vehicle/vehicle';
export interface BatchEligibility {
  driverId: string;
  profileEligible: boolean;
  eligible: boolean;
  availabilityKnown: boolean;
  vehicleType: string | null;
  operationalStatus: string;
  reasons: string[];
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Checks a batch with a fixed number of round trips: drivers (1 SQL), Redis state (1 script),
// vehicles (1 SQL) and, when occupancy is known, the projected status (1 script). The batch
// used to take an advisory lock per driver around ~4 SQL statements and 2 Redis commands.
export class BatchEligibilityUseCase {
  constructor(private readonly store: Store, private readonly state: State, private readonly types: readonly string[], private readonly occupancy?: Occupancy) {}
  async execute(driverIds: readonly string[], type?: string) {
    const ids = driverIds.map(id => id.toLowerCase());
    if (!driverIds.length || driverIds.length > 100 || new Set(ids).size !== driverIds.length || driverIds.some(id => !UUID.test(id)) ||
        (type !== undefined && !this.types.includes(type))) throw new DriverError('INVALID_REQUEST');
    // Cross-service reads come first. Never infer AVAILABLE on a failed lookup.
    const occupied = this.occupancy ? await this.occupancy.lookup(ids).catch(async () => {
      await this.state.projectMany?.(ids.map(id => ({ id, status: 'UNKNOWN' }))).catch(() => {});
      throw new DriverError('DEPENDENCY_UNAVAILABLE');
    }) : undefined;
    const [{ found, migrationRequired }, states] = await Promise.all([
      this.store.read(repo => repo.drivers(ids)),
      this.state.readMany(ids),
    ]).catch(() => { throw new DriverError('DEPENDENCY_UNAVAILABLE'); });
    const vehicleIds = ids.flatMap((id, i) => found.get(id)?.desiredStatus === 'ONLINE' && states[i]!.vehicleId ? [states[i]!.vehicleId!] : []);
    const vehicles = new Map((await this.store.read(repo => repo.vehiclesById(vehicleIds)).catch(() => { throw new DriverError('DEPENDENCY_UNAVAILABLE'); })).map(v => [v.id, v]));
    const projections: Projection[] = [];
    const items = ids.map((id, i): BatchEligibility => {
      if (migrationRequired.has(id)) return rejected(id, 'DRIVER_STATUS_MIGRATION_REQUIRED');
      const driver = found.get(id);
      if (!driver) return rejected(id, 'DRIVER_NOT_FOUND');
      if (driver.desiredStatus === 'OFFLINE') return rejected(id, 'DRIVER_OFFLINE');
      const cache = { ...states[i]! };
      const selected = cache.vehicleId ? vehicles.get(cache.vehicleId) : undefined;
      // A vehicle id that belongs to another driver counts as no vehicle, as the single read did.
      const vehicle = selected && selected.driverId === id ? selected : null;
      const item = decide(id, driver, vehicle, cache, type, occupied?.get(id));
      if (occupied !== undefined) projections.push({ id, status: cache.realtimeStatus as Projection['status'], vehicleId: cache.vehicleId });
      return item;
    });
    if (projections.length && this.state.projectMany) {
      const applied = await this.state.projectMany(projections).catch(() => { throw new DriverError('DEPENDENCY_UNAVAILABLE'); });
      // The driver went OFFLINE or changed vehicle after the read: this answer is stale, so do not offer them.
      projections.forEach((p, k) => {
        if (applied[k]) return;
        const item = items[ids.indexOf(p.id)]!;
        if (item.eligible) Object.assign(item, { eligible: false, reasons: ['DRIVER_STATE_CHANGED'] });
      });
    }
    return { items };
  }
}
function rejected(driverId: string, reason: string): BatchEligibility {
  return { driverId, profileEligible: false, eligible: false, availabilityKnown: true, vehicleType: null, operationalStatus: 'UNKNOWN', reasons: [reason] };
}
/** Same rules as the per-driver check this replaces. Updates `cache.realtimeStatus` when occupancy is known. */
function decide(id: string, driver: Driver, vehicle: Vehicle | null, cache: StateSnapshot, type: string | undefined, occupied: boolean | undefined): BatchEligibility {
  const reasons = eligibilityReasons(driver, vehicle, type);
  const profileEligible = reasons.length === 0;
  if (occupied !== undefined) cache.realtimeStatus = occupied ? 'BUSY' : profileEligible && cache.projectedStatus === 'ONLINE' ? 'AVAILABLE' : 'OFFLINE';
  // Existing projection may be UNKNOWN after ONLINE/cache loss. GPS does not make it AVAILABLE.
  const availabilityKnown = !profileEligible || (cache.projectedStatus === 'ONLINE' && ['AVAILABLE', 'BUSY', 'OFFLINE'].includes(cache.realtimeStatus));
  if (profileEligible && !availabilityKnown) reasons.push('AVAILABILITY_UNDETERMINED');
  else if (profileEligible && cache.realtimeStatus !== 'AVAILABLE') reasons.push(cache.realtimeStatus === 'BUSY' ? 'DRIVER_BUSY' : 'OPERATIONALLY_OFFLINE');
  return { driverId: id, profileEligible, eligible: profileEligible && availabilityKnown && cache.realtimeStatus === 'AVAILABLE',
    availabilityKnown, vehicleType: vehicle?.vehicleType ?? null, operationalStatus: cache.realtimeStatus, reasons };
}
