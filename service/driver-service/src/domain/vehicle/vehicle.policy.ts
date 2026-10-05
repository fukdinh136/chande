import { DriverError } from "../value-objects/error";
import { Vehicle } from "./vehicle";
import { text } from "../value-objects/text";
export function validateVehicle(
  input: {
    vehicleType: string;
    licensePlate: string;
    brandModel: string;
    color: string;
  },
  types: readonly string[],
) {
  const vehicleType = text(input.vehicleType, 20);
  if (!types.includes(vehicleType)) throw new DriverError("INVALID_REQUEST");
  return {
    vehicleType,
    vehiclePlate: text(input.licensePlate, 15).toUpperCase(),
    brandModel: text(input.brandModel, 100),
    color: text(input.color, 30),
  };
}
export function vehicleDto(vehicle: Vehicle) {
  return {
    vehicleId: vehicle.id,
    vehicleType: vehicle.vehicleType,
    licensePlate: vehicle.vehiclePlate,
    brandModel: vehicle.brandModel,
    color: vehicle.color,
    isActive: vehicle.isActive,
    createdAt: vehicle.createdAt.toISOString(),
  };
}
