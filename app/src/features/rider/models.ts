export type TripStatus = 'CREATED' | 'SEARCHING' | 'ASSIGNED' | 'DRIVER_ARRIVED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export const TRIP_STATUSES: readonly TripStatus[] = ['CREATED', 'SEARCHING', 'ASSIGNED', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

/** Điểm theo contract Trip/Routing: toạ độ là chuẩn, address chỉ là nhãn hiển thị. */
export interface Place { lat: number; lng: number; address?: string }

export interface TokenSet { accessToken: string; refreshToken: string; expiresIn: number }
export interface RegisteredUser { id: string; phoneNumber: string; fullName: string; createdAt: string }
export interface UserProfile { id: string; phoneNumber: string; fullName: string; avatarUrl: string | null; createdAt: string }
export interface SavedAddress { id: string; label: string | null; addressText: string; lat: number; lng: number; isDefault: boolean; createdAt: string }
export interface AddressInput { label: string | null; addressText: string; lat: number; lng: number; makeDefault?: boolean }

export interface RouteSummary { distanceMeters: number; durationSeconds: number }
export interface FareLine { code: string; amount: string }
export interface Quote {
  quoteId: string;
  pickup: Place;
  destination: Place;
  vehicleType: string;
  route: RouteSummary;
  fare: { currency: 'VND'; amount: string; breakdown: FareLine[] };
  createdAt: string;
  expiresAt: string;
}
export interface TripDriver { driverId: string; fullName: string; avatarUrl: string | null }
export interface TripVehicle { vehicleId: string; vehicleType: string; licensePlate: string; brand: string | null; color: string | null }
export interface RiderTrip {
  tripId: string;
  quoteId: string;
  riderId: string;
  driverId: string | null;
  vehicleId: string | null;
  status: TripStatus;
  version: number;
  pickup: Place;
  destination: Place;
  vehicleType: string;
  route: RouteSummary;
  fare: { currency: 'VND'; estimatedAmount: string; finalAmount: string | null; breakdown: FareLine[] };
  driver: TripDriver | null;
  vehicle: TripVehicle | null;
  timestamps: {
    requestedAt: string;
    assignedAt: string | null;
    driverArrivedAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
    cancelledAt: string | null;
  };
  cancellation: { actorType: 'RIDER' | 'DRIVER'; reason: string; cancelledAt: string } | null;
}
export interface TripHistoryEntry { fromStatus: TripStatus | null; toStatus: TripStatus; actorType: 'RIDER' | 'DRIVER' | 'SYSTEM'; occurredAt: string; version: number }
export interface TripDetail { trip: RiderTrip; statusHistory: TripHistoryEntry[] }
export interface TripPage { items: RiderTrip[]; nextCursor: string | null }

/** Sự kiện `trip.event` qua WebSocket của gateway: chỉ báo có thay đổi, chi tiết đọc lại qua API. */
export interface TripEvent { eventId: string; type: string; tripId: string; tripVersion: number; status: TripStatus | null }

export const isTerminal = (status: TripStatus) => status === 'COMPLETED' || status === 'CANCELLED';
/** Trip R07: khách huỷ được trước khi bắt đầu đi. */
export const isCancellable = (status: TripStatus) => ['CREATED', 'SEARCHING', 'ASSIGNED', 'DRIVER_ARRIVED'].includes(status);
