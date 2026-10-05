import type { Assignment, Candidate, Command } from '../domain/models';
export interface DriverEligibility { driverId: string; profileEligible: boolean; desiredStatus: string; vehicleId: string | null; driverSnapshot: Assignment['driverSnapshot'] | null; vehicleSnapshot: Assignment['vehicleSnapshot'] | null }
export interface TripState { tripId: string; status: string; driverId: string | null; version: number }
export interface Clients {
  matrix(command: Command): Promise<Candidate[]>;
  driver(id: string, type: string): Promise<DriverEligibility>;
  assign(tripId: string, assignment: Assignment): Promise<void>;
  trip(tripId: string): Promise<TripState>;
}
