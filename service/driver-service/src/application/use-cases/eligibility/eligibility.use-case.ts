import { Store } from "../../ports/unit-of-work.port";
import { State } from "../../ports/state.port";
import { requireDriver } from "../../../domain/driver/driver";
import { desiredStatus } from "../../../domain/driver/status";
import { DriverError } from "../../../domain/value-objects/error";
import { eligibilityReasons } from "../../../domain/policies/eligibility.policy";
import { snapshots } from "../../../domain/policies/snapshots";
export class EligibilityUseCase {
  constructor(
    private readonly store: Store,
    private readonly state: State,
    private readonly types: readonly string[],
  ) {}
  eligibility(id: string, type: string) {
    return this.store.coordinate(id, async () => {
      if (!this.types.includes(type)) throw new DriverError("INVALID_REQUEST");
      const driver = requireDriver(
        await this.store.read((repo) => repo.driver(id)),
      );
      const cache = await this.state.read(id);
      const vehicle = cache.vehicleId
        ? await this.store.read((repo) => repo.vehicle(id, cache.vehicleId!))
        : null;
      const reasons = eligibilityReasons(driver, vehicle, type);
      return {
        driverId: id,
        profileEligible: !reasons.length,
        desiredStatus: desiredStatus(driver.desiredStatus),
        vehicleId: vehicle?.id ?? null,
        reasons,
        ...(!reasons.length && vehicle
          ? snapshots(driver, vehicle)
          : { driverSnapshot: null, vehicleSnapshot: null }),
      };
    });
  }
}
