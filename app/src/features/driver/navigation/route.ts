import { object, string, number } from '../contracts/decode';
import { ApiError } from '../http/errors';
import { decodePolyline } from '../../map/polyline';

function amount(value: unknown) { const result = number(value); if (result < 0 || result > 2147483647) throw new ApiError('INVALID_RESPONSE'); return result; }
function list(value: unknown, minimum: number): unknown[] { if (!Array.isArray(value) || value.length < minimum) throw new ApiError('INVALID_RESPONSE'); return value; }
function coordinate(value: unknown) {
  const pair = list(value, 2);
  if (pair.length !== 2 || Math.abs(number(pair[0])) > 180 || Math.abs(number(pair[1])) > 90) throw new ApiError('INVALID_RESPONSE');
}
export function navigationRoute(value: unknown, vehicleType: string) {
  const data = object(value), route = object(data.route);
  if (data.schemaVersion !== 1 || data.geometryPrecision !== 6 || data.provider !== 'OSRM' || data.vehicleType !== vehicleType || !Number.isFinite(Date.parse(string(data.calculatedAt)))) throw new ApiError('INVALID_RESPONSE');
  const line = decodePolyline(string(route.geometry));
  amount(route.distance); amount(route.duration);
  for (const entry of list(route.legs, 1)) {
    const leg = object(entry); amount(leg.distance); amount(leg.duration); string(leg.summary);
    for (const item of list(leg.steps, 2)) {
      const step = object(item), maneuver = object(step.maneuver);
      amount(step.distance); amount(step.duration); string(step.name);
      if (!string(maneuver.type)) throw new ApiError('INVALID_RESPONSE');
      decodePolyline(string(step.geometry), maneuver.type === 'arrive' && step.distance === 0 ? 1 : 2);
      coordinate(maneuver.location);
      for (const bearing of [maneuver.bearing_before, maneuver.bearing_after]) if (number(bearing) < 0 || number(bearing) > 360) throw new ApiError('INVALID_RESPONSE');
      if (maneuver.modifier !== undefined) string(maneuver.modifier);
    }
  }
  return { route, line, distanceMeters: number(route.distance), durationSeconds: number(route.duration) };
}
