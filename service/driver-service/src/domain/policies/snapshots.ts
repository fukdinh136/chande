import { Driver } from "../driver/driver";
import { Vehicle } from "../vehicle/vehicle";
export function snapshots(driver: Driver, vehicle: Vehicle) {
  return {
    driverSnapshot: { fullName: driver.name, avatarUrl: driver.avatarUrl },
    vehicleSnapshot: {
      vehicleType: vehicle.vehicleType,
      licensePlate: vehicle.vehiclePlate,
      brand: vehicle.brandModel,
      color: vehicle.color,
    },
  };
}
