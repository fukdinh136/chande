import { Vehicle as VehicleEntity } from "../entities/vehicle.entity";
import { Vehicle } from "../../../domain/vehicle/vehicle";
export function vehicleModel(row: VehicleEntity | null): Vehicle | null {
  if (!row) return null;
  return {
    id: row.id,
    driverId: row.driverId,
    vehicleType: row.vehicleType,
    vehiclePlate: row.vehiclePlate,
    brandModel: row.brandModel,
    color: row.color,
    isActive: row.isActive,
    createdAt: row.createdAt,
  };
}
