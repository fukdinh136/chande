import {point, type Point} from '../backend/clients';

// The map projection is more restrictive than Trip's [-90,90] coordinate schema.
export function bookingPoint(value: unknown): Point {
  const result = point(value);
  if (Math.abs(result.lat) > 85.0511) throw new Error('OUTSIDE_MAP');
  if (result.address !== undefined) {
    const address = result.address.trim();
    if (!address || address.length > 500) throw new Error('INVALID_ADDRESS');
    return {...result, address};
  }
  return result;
}
export function validBookingPoints(pickup: Point | null, destination: Point | null) {
  try {return !!pickup && !!destination && !!bookingPoint(pickup) && !!bookingPoint(destination);}
  catch {return false;}
}

export interface QuoteClock {wall: number; steady: number; server: number; expires: number}
export const steadyNow = () => globalThis.performance?.now() ?? Date.now();
export function quoteRemaining(clock: QuoteClock | null, wall = Date.now(), steady = steadyNow()) {
  if (!clock) return 0;
  // Never extend a quote because the wall clock moved backwards.
  return Math.max(0, clock.expires - clock.server - Math.max(0, wall - clock.wall, steady - clock.steady));
}

export function sheetSizes(available: number, fontScale: number) {
  const height = Math.max(1, available);
  const expanded = Math.max(1, height - Math.min(120, height * 0.25));
  const collapsed = Math.min(expanded * 0.8, Math.max(180, Math.min(300, 210 * fontScale), height * 0.38));
  return {collapsed, expanded};
}
