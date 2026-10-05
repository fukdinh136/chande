import { Vehicle } from "../../domain/vehicle/vehicle";
export interface VehicleRepository {
  vehicles(driverId: string): Promise<Vehicle[]>;
  vehicle(driverId: string, id: string): Promise<Vehicle | null>;
  saveVehicle(vehicle: Vehicle): Promise<Vehicle>;
}
