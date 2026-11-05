import type { Assignment, Candidate, Command } from '../domain/models';
export interface DriverEligibility { driverId: string; profileEligible: boolean; desiredStatus: string; vehicleId: string | null; driverSnapshot: Assignment['driverSnapshot'] | null; vehicleSnapshot: Assignment['vehicleSnapshot'] | null }
export interface TripState { tripId: string; status: string; driverId: string | null; version: number }
export interface Clients {
  matrix(command: Command): Promise<Candidate[]>;
  driver(id: string, type: string): Promise<DriverEligibility>;
  assign(tripId: string, assignment: Assignment): Promise<void>;
  trip(tripId: string): Promise<TripState>;
}
/** A fresh raw location from Realtime (ADR-0001), closest first. */
export interface DriverLocation { driverId: string; latitude: number; longitude: number; distanceMeters: number; recordedAt: string }
/** Driver's batch answer: the rules of the single eligibility check, plus the offer snapshots. */
export interface CandidateEligibility { driverId: string; eligible: boolean; reasons: string[]; vehicleId: string | null; driverSnapshot: Assignment['driverSnapshot'] | null; vehicleSnapshot: Assignment['vehicleSnapshot'] | null }
export interface EtaCell { id: string; status: 'OK' | 'NO_ROUTE'; distanceMeters: number | null; durationSeconds: number | null }
/** The three calls of the direct candidate search, one per service. */
export interface CandidateClients {
  locations(pickup: { lat: number; lng: number }, limit: number): Promise<DriverLocation[]>;
  candidates(driverIds: string[], vehicleType: string): Promise<CandidateEligibility[]>;
  eta(destination: { lat: number; lng: number }, vehicleType: string, origins: { id: string; lat: number; lng: number }[]): Promise<EtaCell[]>;
}
/** A ranked candidate and how to get its eligibility (already known, or asked when its turn comes). */
export interface Ranked { candidate: Candidate; eligibility(): Promise<DriverEligibility> }
/** `exclude` returns the drivers already offered this trip or holding a reservation. */
export interface CandidateSource { find(command: Command, exclude: (driverIds: string[]) => Promise<Set<string>>): Promise<Ranked[]> }
