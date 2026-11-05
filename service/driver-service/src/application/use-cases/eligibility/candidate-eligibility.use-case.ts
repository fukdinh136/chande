import { Store } from '../../ports/unit-of-work.port';
import { State } from '../../ports/state.port';
import { DriverError } from '../../../domain/value-objects/error';
import { eligibilityReasons } from '../../../domain/policies/eligibility.policy';
import { snapshots } from '../../../domain/policies/snapshots';
import { batchIds, readBatch } from './read-batch';
export interface CandidateEligibility {
  driverId: string;
  eligible: boolean;
  reasons: string[];
  vehicleId: string | null;
  driverSnapshot: ReturnType<typeof snapshots>['driverSnapshot'] | null;
  vehicleSnapshot: ReturnType<typeof snapshots>['vehicleSnapshot'] | null;
}
// Matching's batch check (ADR-0001): the same rules as GET /:id/eligibility, for up to 100 drivers in
// 2 SQL statements and 1 Redis script. It does not ask Trip or Matching who is busy: Matching already
// excludes reserved drivers, and Trip's one-active-trip-per-driver constraint is the last guard.
// It writes nothing, so it needs no lock. A driver that cannot be read is rejected on its own.
export class CandidateEligibilityUseCase {
  constructor(private readonly store: Store, private readonly state: State, private readonly types: readonly string[]) {}
  async execute(driverIds: readonly string[], type: string): Promise<{ items: CandidateEligibility[] }> {
    if (!this.types.includes(type)) throw new DriverError('INVALID_REQUEST');
    const ids = batchIds(driverIds, this.types, type);
    const { found, migrationRequired, vehicle: vehicleOf } = await readBatch(this.store, this.state, ids);
    const items = ids.map((driverId, i): CandidateEligibility => {
      const rejected = (reason: string) => ({ driverId, eligible: false, reasons: [reason], vehicleId: null, driverSnapshot: null, vehicleSnapshot: null });
      if (migrationRequired.has(driverId)) return rejected('DRIVER_STATUS_MIGRATION_REQUIRED');
      const driver = found.get(driverId);
      if (!driver) return rejected('DRIVER_NOT_FOUND');
      const vehicle = vehicleOf(driverId, i);
      const reasons = eligibilityReasons(driver, vehicle, type);
      if (reasons.length || !vehicle) return { driverId, eligible: false, reasons, vehicleId: vehicle?.id ?? null, driverSnapshot: null, vehicleSnapshot: null };
      return { driverId, eligible: true, reasons, vehicleId: vehicle.id, ...snapshots(driver, vehicle) };
    });
    return { items };
  }
}
