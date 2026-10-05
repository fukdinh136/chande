import type { TripStatus } from './state-machine';
export interface Principal { sub: string; role: 'RIDER' | 'DRIVER' }
export interface Actor { id: string | null; type: 'RIDER' | 'DRIVER' | 'SYSTEM' }
export interface Location { lat: number; lng: number; address?: string }
export interface RouteSummary { distanceMeters: number; durationSeconds: number }
export interface FareLine { code: string; amount: string }
export interface QuoteFare { currency: 'VND'; amount: string; breakdown: FareLine[] }
export interface Quote {
  quoteId: string; riderId: string; pickup: Location; destination: Location; vehicleType: string;
  route: RouteSummary; fare: QuoteFare; createdAt: string; expiresAt: string; consumedTripId: string | null;
}
export interface DriverSnapshot { fullName: string; avatarUrl: string | null }
export interface VehicleSnapshot { vehicleType: string; licensePlate: string; brand: string | null; color: string | null }
export interface Assignment { eventId: string; driverId: string; vehicleId: string; driverSnapshot: DriverSnapshot; vehicleSnapshot: VehicleSnapshot }
export interface HistoryEntry { fromStatus: TripStatus | null; toStatus: TripStatus; actorType: Actor['type']; actorId: string | null; occurredAt: string; version: number }
export interface TripData {
  tripId: string; quoteId: string; riderId: string; driverId: string | null; vehicleId: string | null;
  status: TripStatus; version: number; pickup: Location; destination: Location; vehicleType: string;
  route: RouteSummary; fare: { currency: 'VND'; estimatedAmount: string; finalAmount: string | null; breakdown: FareLine[] };
  driver: (DriverSnapshot & { driverId: string }) | null; vehicle: (VehicleSnapshot & { vehicleId: string }) | null;
  timestamps: { requestedAt: string; assignedAt: string | null; driverArrivedAt: string | null; startedAt: string | null; completedAt: string | null; cancelledAt: string | null };
  cancellation: { actorType: 'RIDER' | 'DRIVER'; actorId: string; reason: string; cancelledAt: string } | null;
}
