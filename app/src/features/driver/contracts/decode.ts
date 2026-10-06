import { ApiError } from '../http/errors';
import type {
  Availability, DriverProfile, OtpChallenge, Session, Trip, TripDetail,
  TripPage, TripStatus, Vehicle, TripCommand,
} from './models';

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('INVALID_RESPONSE');
  return value as Record<string, unknown>;
}
export function string(value: unknown): string {
  if (typeof value !== 'string') throw new ApiError('INVALID_RESPONSE');
  return value;
}
export function nullableString(value: unknown) { return value === null ? null : string(value); }
export function uuid(value: unknown) {
  const id = string(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new ApiError('INVALID_RESPONSE');
  return id.toLowerCase();
}
export function number(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new ApiError('INVALID_RESPONSE');
  return value;
}
function integer(value: unknown, min = 0) {
  const result = number(value);
  if (!Number.isInteger(result) || result < min || result > 2147483647) throw new ApiError('INVALID_RESPONSE');
  return result;
}
export function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new ApiError('INVALID_RESPONSE');
  return value as T;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new ApiError('INVALID_RESPONSE');
  return value;
}
const statuses: readonly TripStatus[] = ['CREATED', 'SEARCHING', 'ASSIGNED', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
export function profile(value: unknown): DriverProfile {
  const data = object(value);
  return {
    driverId: uuid(data.driverId), phoneNumber: string(data.phoneNumber),
    fullName: string(data.fullName), avatarUrl: nullableString(data.avatarUrl),
    licenseNumber: string(data.licenseNumber), desiredStatus: oneOf(data.desiredStatus, ['ONLINE', 'OFFLINE']),
    createdAt: string(data.createdAt), updatedAt: string(data.updatedAt),
  };
}
export function vehicle(value: unknown): Vehicle {
  const data = object(value);
  if (typeof data.isActive !== 'boolean') throw new ApiError('INVALID_RESPONSE');
  return {
    vehicleId: uuid(data.vehicleId), vehicleType: string(data.vehicleType),
    licensePlate: string(data.licensePlate), brandModel: string(data.brandModel),
    color: string(data.color), isActive: data.isActive, createdAt: string(data.createdAt),
  };
}
export function vehicles(value: unknown) { return array(object(value).items).map(vehicle); }
export function availability(value: unknown): Availability {
  const data = object(value);
  return {
    desiredStatus: oneOf(data.desiredStatus, ['ONLINE', 'OFFLINE']),
    selectedVehicleId: data.selectedVehicleId === null ? null : uuid(data.selectedVehicleId),
    realtimeStatus: oneOf(data.realtimeStatus, ['AVAILABLE', 'BUSY', 'OFFLINE', 'UNKNOWN']),
    realtimeSync: oneOf(data.realtimeSync, ['APPLIED', 'PENDING']),
  };
}
export function session(value: unknown): Session {
  const data = object(value);
  const accessToken = string(data.accessToken);
  const refreshToken = string(data.refreshToken);
  const expiresIn = integer(data.expiresIn, 1);
  const refreshExpiresAt = string(data.refreshExpiresAt);
  if (!accessToken || refreshToken.length < 32 || !Number.isFinite(Date.parse(refreshExpiresAt))) throw new ApiError('INVALID_RESPONSE');
  return { accessToken, refreshToken, expiresIn, refreshExpiresAt, tokenType: oneOf(data.tokenType, ['Bearer']), driver: profile(data.driver) };
}
export function challenge(value: unknown): OtpChallenge {
  const data = object(value);
  return { challengeId: uuid(data.challengeId), expiresIn: integer(data.expiresIn, 1), retryAfterSeconds: integer(data.retryAfterSeconds) };
}
export function trip(value: unknown): Trip {
  const data = object(value);
  const fare = object(data.fare);
  const point = (value: unknown) => {
    const p = object(value);
    const lat = number(p.lat), lng = number(p.lng);
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new ApiError('INVALID_RESPONSE');
    return { lat, lng, ...(p.address === undefined ? {} : { address: string(p.address) }) };
  };
  return {
    tripId: uuid(data.tripId), driverId: data.driverId === null ? null : uuid(data.driverId),
    vehicleId: data.vehicleId === null ? null : uuid(data.vehicleId),
    status: oneOf(data.status, statuses), version: integer(data.version),
    pickup: point(data.pickup), destination: point(data.destination), vehicleType: string(data.vehicleType),
    fare: { currency: oneOf(fare.currency, ['VND']), estimatedAmount: string(fare.estimatedAmount), finalAmount: nullableString(fare.finalAmount) },
    ...(data.driver===undefined?{}:{driver:data.driver===null?null:{fullName:string(object(data.driver).fullName),avatarUrl:nullableString(object(data.driver).avatarUrl)}}),
    ...(data.vehicle===undefined?{}:{vehicle:data.vehicle===null?null:{licensePlate:string(object(data.vehicle).licensePlate),brand:nullableString(object(data.vehicle).brand),color:nullableString(object(data.vehicle).color)}}),
  };
}
export function activeTrip(value: unknown) { return value === null ? null : trip(value); }
export function tripDetail(value: unknown): TripDetail {
  const data = object(value);
  return { trip: trip(data.trip), statusHistory: array(data.statusHistory).map((value) => {
    const entry = object(value);
    return {
      fromStatus: entry.fromStatus === null ? null : oneOf(entry.fromStatus, statuses),
      toStatus: oneOf(entry.toStatus, statuses), actorType: oneOf(entry.actorType, ['RIDER', 'DRIVER', 'SYSTEM']),
      occurredAt: string(entry.occurredAt), version: integer(entry.version),
    };
  }) };
}
export function tripPage(value: unknown): TripPage {
  const data = object(value);
  return { items: array(data.items).map(trip), nextCursor: nullableString(data.nextCursor) };
}
export function command(value: unknown): TripCommand {
  const data = object(value), body = object(data.body);
  const base = { driverId: uuid(data.driverId), tripId: uuid(data.tripId), key: uuid(data.key), createdAt: string(data.createdAt) };
  const version = integer(body.version, 1);
  if (data.kind === 'status') return { ...base, kind: 'status', body: { version, status: oneOf(body.status, ['DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED']) } };
  if (data.kind === 'cancel') {
    const reason = string(body.reason);
    if (!reason.trim() || reason.length > 500) throw new ApiError('INVALID_RESPONSE');
    return { ...base, kind: 'cancel', body: { version, reason } };
  }
  throw new ApiError('INVALID_RESPONSE');
}
