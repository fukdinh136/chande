import type { MapProvider, Context, Clock } from '../../application/ports/clients';
import type { RouteRequest, MatrixRequest, Route, Cell } from '../../domain/models';
import { checkpoint } from '../../application/context';
import { encodePolyline } from './polyline';
/** Explicit fixture data; never used as fallback for a failed real provider. */
export class MockMapProvider implements MapProvider {
  constructor(private readonly clock: Clock) {}
  async route(input: RouteRequest, context: Context): Promise<Route> {
    checkpoint(context, this.clock);
    return { distanceMeters: 4000, durationSeconds: 600, steps: [], ...(input.full ? { polyline: { encoding: 'encoded_polyline' as const, precision: 6 as const, value: encodePolyline([input.origin, input.destination]) } } : {}) };
  }
  async matrix(input: MatrixRequest, context: Context): Promise<Cell[]> {
    checkpoint(context, this.clock);
    return input.origins.map((_, i) => ({ status: 'OK', distanceMeters: 1000 + i * 100, durationSeconds: 180 + i * 10 }));
  }
}
