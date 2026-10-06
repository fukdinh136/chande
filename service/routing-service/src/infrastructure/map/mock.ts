import type { MapProvider, Context, Clock } from '../../application/ports/clients';
import type { RouteRequest, MatrixRequest, Route, Cell } from '../../domain/models';
import { checkpoint } from '../../application/context';
import { encodePolyline } from './polyline';
/** Explicit fixture data; never used as fallback for a failed real provider. */
export class MockMapProvider implements MapProvider {
  constructor(private readonly clock: Clock) {}
  async route(input: RouteRequest, context: Context): Promise<Route> {
    checkpoint(context, this.clock);
    const geometry = encodePolyline([input.origin, input.destination]);
    return { distanceMeters: 4000, durationSeconds: 600, steps: [], ...(input.full ? { polyline: { encoding: 'encoded_polyline' as const, precision: 6 as const, value: geometry } } : {}), ...(input.navigation ? { navigation: { geometry, distance: 4000, duration: 600, legs: [{ distance: 4000, duration: 600, summary: 'Mock route', steps: [{ geometry, distance: 4000, duration: 600, name: '', maneuver: { type: 'depart', bearing_before: 0, bearing_after: 0, location: [input.origin.lng,input.origin.lat] as [number,number] } },{ geometry: encodePolyline([input.destination,input.destination]), distance: 0, duration: 0, name: '', maneuver: { type: 'arrive', bearing_before: 0, bearing_after: 0, location: [input.destination.lng,input.destination.lat] as [number,number] } }] }] } } : {}) };
  }
  async matrix(input: MatrixRequest, context: Context): Promise<Cell[]> {
    checkpoint(context, this.clock);
    return input.origins.map((_, i) => ({ status: 'OK', distanceMeters: 1000 + i * 100, durationSeconds: 180 + i * 10 }));
  }
}
