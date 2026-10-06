import { RiderError } from './errors';
import {
  TRIP_STATUSES, type FareLine, type Place, type Quote, type RegisteredUser, type RiderTrip, type RouteSummary, type SavedAddress,
  type TokenSet, type TripDetail, type TripEvent, type TripPage, type TripStatus, type UserProfile,
} from './models';

// Kiểm tra dữ liệu trả về đúng contract trước khi đưa lên giao diện; sai thì báo INVALID_RESPONSE.
const invalid = () => new RiderError('INVALID_RESPONSE');
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw invalid();
  return value;
}
function string(value: unknown): string {
  if (typeof value !== 'string') throw invalid();
  return value;
}
const nullableString = (value: unknown) => (value === null || value === undefined ? null : string(value));
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid();
  return value;
}
function integer(value: unknown, min = 0): number {
  const result = number(value);
  if (!Number.isInteger(result) || result < min) throw invalid();
  return result;
}
function uuid(value: unknown): string {
  const id = string(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw invalid();
  return id.toLowerCase();
}
const nullableUuid = (value: unknown) => (value === null || value === undefined ? null : uuid(value));
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw invalid();
  return value as T;
}
function amount(value: unknown): string {
  const text = string(value);
  if (!/^\d+$/.test(text)) throw invalid();
  return text;
}
const status = (value: unknown): TripStatus => oneOf(value, TRIP_STATUSES);

function place(value: unknown): Place {
  const data = object(value);
  const lat = number(data.lat), lng = number(data.lng);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) throw invalid();
  return { lat, lng, ...(typeof data.address === 'string' ? { address: data.address } : {}) };
}
function route(value: unknown): RouteSummary {
  const data = object(value);
  return { distanceMeters: integer(data.distanceMeters), durationSeconds: integer(data.durationSeconds) };
}
function breakdown(value: unknown): FareLine[] {
  return array(value).map((item) => {
    const line = object(item);
    return { code: string(line.code), amount: amount(line.amount) };
  });
}

export function tokens(value: unknown): TokenSet {
  const data = object(value);
  const accessToken = string(data.accessToken), refreshToken = string(data.refreshToken);
  if (!accessToken || !refreshToken) throw invalid();
  return { accessToken, refreshToken, expiresIn: integer(data.expiresIn, 1) };
}
export function registered(value: unknown): RegisteredUser {
  const data = object(value);
  return { id: uuid(data.id), phoneNumber: string(data.phoneNumber), fullName: string(data.fullName), createdAt: string(data.createdAt) };
}
export function profile(value: unknown): UserProfile {
  const data = object(value);
  return {
    id: uuid(data.id), phoneNumber: string(data.phoneNumber), fullName: string(data.fullName),
    avatarUrl: nullableString(data.avatarUrl), createdAt: string(data.createdAt),
  };
}
export function address(value: unknown): SavedAddress {
  const data = object(value);
  if (typeof data.isDefault !== 'boolean') throw invalid();
  const point = place({ lat: data.lat, lng: data.lng });
  return {
    id: uuid(data.id), label: nullableString(data.label), addressText: string(data.addressText),
    lat: point.lat, lng: point.lng, isDefault: data.isDefault, createdAt: string(data.createdAt),
  };
}
export const addresses = (value: unknown) => array(value).map(address);

export function quote(value: unknown): Quote {
  const data = object(value);
  const fare = object(data.fare);
  return {
    quoteId: uuid(data.quoteId), pickup: place(data.pickup), destination: place(data.destination),
    vehicleType: string(data.vehicleType), route: route(data.route),
    fare: { currency: oneOf(fare.currency, ['VND']), amount: amount(fare.amount), breakdown: breakdown(fare.breakdown) },
    createdAt: string(data.createdAt), expiresAt: string(data.expiresAt),
  };
}

export function trip(value: unknown): RiderTrip {
  const data = object(value);
  const fare = object(data.fare);
  const times = object(data.timestamps);
  const driver = data.driver === null || data.driver === undefined ? null : object(data.driver);
  const vehicle = data.vehicle === null || data.vehicle === undefined ? null : object(data.vehicle);
  const cancellation = data.cancellation === null || data.cancellation === undefined ? null : object(data.cancellation);
  return {
    tripId: uuid(data.tripId), quoteId: uuid(data.quoteId), riderId: uuid(data.riderId),
    driverId: nullableUuid(data.driverId), vehicleId: nullableUuid(data.vehicleId),
    status: status(data.status), version: integer(data.version),
    pickup: place(data.pickup), destination: place(data.destination), vehicleType: string(data.vehicleType), route: route(data.route),
    fare: {
      currency: oneOf(fare.currency, ['VND']), estimatedAmount: amount(fare.estimatedAmount),
      finalAmount: fare.finalAmount === null ? null : amount(fare.finalAmount), breakdown: breakdown(fare.breakdown),
    },
    driver: driver ? { driverId: uuid(driver.driverId), fullName: string(driver.fullName), avatarUrl: nullableString(driver.avatarUrl) } : null,
    vehicle: vehicle ? {
      vehicleId: uuid(vehicle.vehicleId), vehicleType: string(vehicle.vehicleType), licensePlate: string(vehicle.licensePlate),
      brand: nullableString(vehicle.brand), color: nullableString(vehicle.color),
    } : null,
    timestamps: {
      requestedAt: string(times.requestedAt), assignedAt: nullableString(times.assignedAt),
      driverArrivedAt: nullableString(times.driverArrivedAt), startedAt: nullableString(times.startedAt),
      completedAt: nullableString(times.completedAt), cancelledAt: nullableString(times.cancelledAt),
    },
    cancellation: cancellation ? {
      actorType: oneOf(cancellation.actorType, ['RIDER', 'DRIVER']), reason: string(cancellation.reason), cancelledAt: string(cancellation.cancelledAt),
    } : null,
  };
}
export const activeTrip = (value: unknown) => (value === null ? null : trip(value));

export function tripDetail(value: unknown): TripDetail {
  const data = object(value);
  return {
    trip: trip(data.trip),
    statusHistory: array(data.statusHistory).map((item) => {
      const entry = object(item);
      return {
        fromStatus: entry.fromStatus === null ? null : status(entry.fromStatus), toStatus: status(entry.toStatus),
        actorType: oneOf(entry.actorType, ['RIDER', 'DRIVER', 'SYSTEM']), occurredAt: string(entry.occurredAt), version: integer(entry.version),
      };
    }),
  };
}
export function tripPage(value: unknown): TripPage {
  const data = object(value);
  return { items: array(data.items).map(trip), nextCursor: nullableString(data.nextCursor) };
}

/** Bỏ qua (trả null) sự kiện sai định dạng thay vì làm hỏng kết nối realtime. */
export function tripEvent(value: unknown): TripEvent | null {
  try {
    const data = object(value);
    const payload = data.data && typeof data.data === 'object' ? object(data.data) : {};
    return {
      eventId: string(data.eventId), type: string(data.type), tripId: uuid(data.tripId), tripVersion: integer(data.tripVersion),
      status: typeof payload.status === 'string' && TRIP_STATUSES.includes(payload.status as TripStatus) ? payload.status as TripStatus : null,
    };
  } catch { return null; }
}
