import { State } from "../../ports/state.port";
import { DriverError } from "../../../domain/value-objects/error";
import { requireDriver } from "../../../domain/driver/driver";
import { requireVehicle } from "../../../domain/vehicle/vehicle";
import {
  validateVehicle,
  vehicleDto,
} from "../../../domain/vehicle/vehicle.policy";
import { Store } from "../../ports/unit-of-work.port";
import { Runtime } from "../../ports/runtime.port";
import { EditPolicy } from "./edit.policy";
export class VehicleUseCases {
  constructor(
    private readonly store: Store,
    private readonly runtime: Runtime,
    private readonly types: readonly string[],
    private readonly maxVehicles: number,
    private readonly policy: EditPolicy,
    private readonly state: State,
  ) {}
  async vehicles(id: string) {
    return {
      items: (await this.store.read((repo) => repo.vehicles(id))).map(
        vehicleDto,
      ),
    };
  }
  async vehicle(id: string, vehicleId: string) {
    return vehicleDto(
      requireVehicle(
        await this.store.read((repo) => repo.vehicle(id, vehicleId)),
      ),
    );
  }
  async createVehicle(
    id: string,
    input: {
      vehicleType: string;
      licensePlate: string;
      brandModel: string;
      color: string;
    },
  ) {
    return this.store.coordinate(id, async () => {
      const fields = validateVehicle(input, this.types);
      return this.store.transaction(async (repo) => {
        requireDriver(await repo.driver(id, true));

        if ((await repo.vehicles(id)).length >= this.maxVehicles)
          throw new DriverError("VEHICLE_LIMIT_REACHED");
        return vehicleDto(
          await repo.saveVehicle({
            ...fields,
            id: this.runtime.id(),
            driverId: id,
            isActive: true,
            createdAt: this.runtime.now(),
          }),
        );
      });
    });
  }
  async updateVehicle(
    id: string,
    vehicleId: string,
    input: {
      vehicleType?: string;
      licensePlate?: string;
      brandModel?: string;
      color?: string;
      isActive?: boolean;
    },
    authorization: string,
  ) {
    return this.store.coordinate(id, async () => {
      if (!Object.keys(input).length) throw new DriverError("INVALID_REQUEST");
      requireVehicle(
        await this.store.read((repo) => repo.vehicle(id, vehicleId)),
      );
      await this.policy.requireEditable(id, authorization);
      const updated = await this.store.transaction(async (repo) => {
        requireDriver(await repo.driver(id, true));
        const vehicle = requireVehicle(await repo.vehicle(id, vehicleId));
        const fields = validateVehicle(
          {
            vehicleType: input.vehicleType ?? vehicle.vehicleType,
            licensePlate: input.licensePlate ?? vehicle.vehiclePlate,
            brandModel: input.brandModel ?? vehicle.brandModel,
            color: input.color ?? vehicle.color,
          },
          this.types,
        );
        return vehicleDto(
          await repo.saveVehicle({
            ...vehicle,
            ...fields,
            isActive: input.isActive ?? vehicle.isActive,
          }),
        );
      });

      if (!updated.isActive) {
        try {
          await this.state.clearSelection(id, vehicleId);
        } catch {
          /* GET availability retries cleanup; committed vehicle is already ineligible. */
        }
      }
      return updated;
    });
  }
}
