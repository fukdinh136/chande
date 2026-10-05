import { Store } from "../../ports/unit-of-work.port";
import { TripActive } from "../../ports/trip-active.port";
import { requireDriver } from "../../../domain/driver/driver";
import { DriverError } from "../../../domain/value-objects/error";
export class EditPolicy {
  constructor(
    private readonly store: Store,
    private readonly trip: TripActive,
  ) {}
  async requireEditable(id: string, authorization: string) {
    const driver = requireDriver(
      await this.store.read((repo) => repo.driver(id)),
    );
    if (driver.desiredStatus !== "OFFLINE")
      throw new DriverError("DRIVER_MUST_BE_OFFLINE");
    if (await this.trip.active(authorization))
      throw new DriverError("DRIVER_HAS_ACTIVE_TRIP");
  }
}
