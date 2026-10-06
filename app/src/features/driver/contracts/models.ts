export type DesiredStatus = 'ONLINE' | 'OFFLINE';
export interface DriverProfile {
  driverId: string;
  phoneNumber: string;
  fullName: string;
  avatarUrl: string | null;
  licenseNumber: string;
  desiredStatus: DesiredStatus;
  createdAt: string;
  updatedAt: string;
}
export interface VehicleInput {
  vehicleType: string;
  licensePlate: string;
  brandModel: string;
  color: string;
}
export interface Vehicle extends VehicleInput {
  vehicleId: string;
  isActive: boolean;
  createdAt: string;
}
export interface Availability {
  desiredStatus: DesiredStatus;
  selectedVehicleId: string | null;
  realtimeStatus: 'AVAILABLE' | 'BUSY' | 'OFFLINE' | 'UNKNOWN';
  realtimeSync: 'APPLIED' | 'PENDING';
}
export interface Session {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: string;
  driver: DriverProfile;
}
export interface OtpChallenge {
  challengeId: string;
  expiresIn: number;
  retryAfterSeconds: number;
}
export type TripStatus =
  | 'CREATED' | 'SEARCHING' | 'ASSIGNED' | 'DRIVER_ARRIVED'
  | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type DriverTripStatus = 'DRIVER_ARRIVED' | 'IN_PROGRESS' | 'COMPLETED';
export interface TripLocation { lat: number; lng: number; address?: string }
// Projection of Trip's public response: only the fields rendered by this module.
export interface Trip {
  tripId: string;
  driverId: string | null;
  vehicleId: string | null;
  status: TripStatus;
  version: number;
  pickup: TripLocation;
  destination: TripLocation;
  vehicleType: string;
  fare: { currency: 'VND'; estimatedAmount: string; finalAmount: string | null };
  driver?: {fullName:string;avatarUrl:string|null}|null;
  vehicle?: {licensePlate:string;brand:string|null;color:string|null}|null;
}
export interface TripHistoryEntry {
  fromStatus: TripStatus | null;
  toStatus: TripStatus;
  actorType: 'RIDER' | 'DRIVER' | 'SYSTEM';
  occurredAt: string;
  version: number;
}
export interface TripDetail { trip: Trip; statusHistory: TripHistoryEntry[] }
export interface TripPage { items: Trip[]; nextCursor: string | null }
export type TripCommand = {
  driverId: string;
  tripId: string;
  key: string;
  createdAt: string;
} & (
  | { kind: 'status'; body: { status: DriverTripStatus; version: number } }
  | { kind: 'cancel'; body: { reason: string; version: number } }
);
export function isTerminal(trip: Trip) {
  return trip.status === 'COMPLETED' || trip.status === 'CANCELLED';
}
export function nextStatus(trip: Trip): DriverTripStatus | null {
  if (trip.status === 'ASSIGNED') return 'DRIVER_ARRIVED';
  if (trip.status === 'DRIVER_ARRIVED') return 'IN_PROGRESS';
  if (trip.status === 'IN_PROGRESS') return 'COMPLETED';
  return null;
}
