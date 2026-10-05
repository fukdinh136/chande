import { desiredStatus, DesiredStatus } from "../../../domain/driver/status";
import { requireDriver, Driver } from "../../../domain/driver/driver";
import { requireVehicle } from "../../../domain/vehicle/vehicle";
import { DriverError } from "../../../domain/value-objects/error";
import { profileEligible } from "../../../domain/policies/profile.policy";
import { Store } from "../../ports/unit-of-work.port";
import { State } from "../../ports/state.port";
import { Runtime } from "../../ports/runtime.port";
import { EditPolicy } from "../vehicle/edit.policy";
export class AvailabilityUseCases {
  constructor(
    private readonly store: Store,
    private readonly state: State,
    private readonly policy: EditPolicy,
    private readonly runtime: Runtime,
  ) {}
  select(id: string, vehicleId: string, authorization: string) {
    return this.store.coordinate(id, async () => {
      await this.policy.requireEditable(id, authorization);
      const vehicle = requireVehicle(
        await this.store.read((repo) => repo.vehicle(id, vehicleId)),
      );
      if (!vehicle.isActive) throw new DriverError("VEHICLE_INACTIVE");
      await this.state.select(id, vehicleId);
      return this.availability(id);
    });
  }
  availability(id: string) {
    return this.store.coordinate(id, async () => {
      const driver = requireDriver(
        await this.store.read((repo) => repo.driver(id)),
      );
      return this.project(driver);
    });
  }
  setAvailability(id: string, desired: DesiredStatus) {
    return this.store.coordinate(id, async () => {
      // Dependencies are read before opening the write transaction. Recheck
      // durable profile/ownership/activity under the row lock before committing.
      let selectedVehicleId: string | null = null;
      if (desired === "ONLINE") {
        const current = requireDriver(
          await this.store.read((repo) => repo.driver(id)),
        );
        if (!profileEligible(current))
          throw new DriverError("PROFILE_INCOMPLETE");
        selectedVehicleId = (await this.state.read(id)).vehicleId;
        if (!selectedVehicleId) throw new DriverError("VEHICLE_REQUIRED");
      }
      const driver = await this.store.transaction(async (repo) => {
        const current = requireDriver(await repo.driver(id, true));
        if (desired === "ONLINE") {
          if (!profileEligible(current))
            throw new DriverError("PROFILE_INCOMPLETE");
          const vehicle = requireVehicle(
            await repo.vehicle(id, selectedVehicleId!),
          );
          if (!vehicle.isActive) throw new DriverError("VEHICLE_INACTIVE");
        }
        current.desiredStatus = desired;
        current.updatedAt = this.runtime.now();
        return repo.saveDriver(current);
      });
      // The SQL transaction has committed. A cache failure cannot undo this intent.
      try {
        await this.state.setDesired(id, desired);
      } catch {
        return this.pending(driver);
      }
      return this.project(driver);
    });
  }
  private pending(driver: Driver) {
    return {
      desiredStatus: desiredStatus(driver.desiredStatus),
      selectedVehicleId: null,
      realtimeStatus: "UNKNOWN",
      realtimeSync: "PENDING",
    };
  }
  private async project(driver: Driver) {
    try {
      let cache = await this.state.read(driver.id);
      if (cache.projectedStatus !== driver.desiredStatus) {
        await this.state.setDesired(
          driver.id,
          desiredStatus(driver.desiredStatus),
        );
        cache = await this.state.read(driver.id);
      }
      const vehicle = cache.vehicleId
        ? await this.store.read((repo) =>
            repo.vehicle(driver.id, cache.vehicleId!),
          )
        : null;
      if (cache.vehicleId && !vehicle?.isActive)
        await this.state.clearSelection(driver.id, cache.vehicleId);
      return {
        desiredStatus: desiredStatus(driver.desiredStatus),
        selectedVehicleId: vehicle?.isActive ? vehicle.id : null,
        realtimeStatus: vehicle?.isActive ? cache.realtimeStatus : "UNKNOWN",
        realtimeSync: "APPLIED",
      };
    } catch {
      return this.pending(driver);
    }
  }
}
