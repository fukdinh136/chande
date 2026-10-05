import { Vehicle as VehicleEntity } from "../entities/vehicle.entity";
import { Vehicle } from "../../../domain/vehicle/vehicle";
import { vehicleModel } from "../mappers/vehicle.mapper";
import { EntityManager } from "typeorm";
import { VehicleRepository } from "../../../application/ports/vehicle-repository.port";
export class PostgresVehicleRepository implements VehicleRepository {
  constructor(private readonly manager: EntityManager) {}
  async vehicles(driverId: string) {
    return (
      await this.manager.find(VehicleEntity, {
        where: { driverId },
        order: { createdAt: "DESC" },
      })
    ).map((row) => vehicleModel(row)!);
  }
  async vehicle(driverId: string, id: string) {
    return vehicleModel(
      await this.manager.findOne(VehicleEntity, { where: { id, driverId } }),
    );
  }
  async saveVehicle(vehicle: Vehicle) {
    return vehicleModel(
      await this.manager.save(
        VehicleEntity,
        this.manager.create(VehicleEntity, vehicle),
      ),
    )!;
  }
}
