import { Vehicle } from "../../domain/vehicle/vehicle";
export interface VehicleRepository {
  vehicles(driverId: string): Promise<Vehicle[]>;
  vehicle(driverId: string, id: string): Promise<Vehicle | null>;
  /** Reads a batch by vehicle id in one query; the caller checks the owner. */
  vehiclesById(ids: readonly string[]): Promise<Vehicle[]>;
  saveVehicle(vehicle: Vehicle): Promise<Vehicle>;
}
