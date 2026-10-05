import { DriverError } from "../value-objects/error";
export interface Vehicle {
  id: string;
  driverId: string;
  vehicleType: string;
  vehiclePlate: string;
  brandModel: string;
  color: string;
  isActive: boolean;
  createdAt: Date;
}
export function requireVehicle(value: Vehicle | null): Vehicle {
  if (!value) throw new DriverError("RESOURCE_NOT_FOUND");
  return value;
}
