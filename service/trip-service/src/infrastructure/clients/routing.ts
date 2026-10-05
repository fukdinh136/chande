import { z } from 'zod';
import type { RoutingPort } from '../../application/ports/clients';
import type { Location, RouteSummary } from '../../domain/models';
import { DomainError } from '../../domain/error';
import { JsonHttpClient } from './http';
export const routeSchema = z.object({ distanceMeters: z.number().int().min(0).max(2147483647), durationSeconds: z.number().int().min(0).max(2147483647) }).strict();
export class RoutingClient implements RoutingPort {
  constructor(private readonly http: JsonHttpClient) {}
  async estimate(pickup: Location, destination: Location, vehicleType: string, requestId: string): Promise<RouteSummary> {
    try { return await this.http.post('/internal/routes/estimate', { pickup, destination, vehicleType }, requestId, routeSchema); }
    catch { throw new DomainError('DEPENDENCY_UNAVAILABLE'); }
  }
}
