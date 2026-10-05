import { z } from 'zod';
import { RoutingError, invalidProvider } from './errors';
export const locationSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), address: z.string().max(500).optional() }).strict();
export type Location = z.infer<typeof locationSchema>;
export const driverSchema = z.object({ driverId: z.string().trim().min(1).max(128), location: locationSchema, observedAt: z.iso.datetime() }).strict();
export type DriverLocation = z.infer<typeof driverSchema>;
export function driverSnapshot(value: unknown): DriverLocation[] {
  const result = z.array(driverSchema).safeParse(value);
  if (!result.success || new Set(result.data.map(d => d.driverId)).size !== result.data.length) throw new RoutingError('INVALID_REALTIME_RESPONSE', 503);
  return result.data;
}
export function measurement(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || Math.ceil(value) > 2147483647) throw invalidProvider();
  return Math.ceil(value);
}
export interface Summary { distanceMeters: number; durationSeconds: number }
export interface Step extends Summary {
  streetName: string | null; instruction: null;
  maneuver: { type: string; modifier: string | null; location: Location; exit: number | null };
}
export interface Route extends Summary { polyline?: { encoding: 'encoded_polyline'; precision: 6; value: string }; steps: Step[] }
export type Cell = ({ status: 'OK' } & Summary) | { status: 'NO_ROUTE'; distanceMeters: null; durationSeconds: null };
export interface RouteRequest { origin: Location; destination: Location; vehicleType: string; full: boolean; includeSteps: boolean }
export interface MatrixRequest { origins: Location[]; destination: Location; vehicleType: string }
export type MapJob = { kind: 'route'; input: RouteRequest } | { kind: 'matrix'; input: MatrixRequest };
export function requireVehicle(vehicle: string, supported: readonly string[]): void {
  if (!supported.includes(vehicle)) throw new RoutingError('UNSUPPORTED_VEHICLE_TYPE', 400);
}
