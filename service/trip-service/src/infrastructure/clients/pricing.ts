import { z } from 'zod';
import type { PricingPort } from '../../application/ports/clients';
import type { QuoteFare, RouteSummary } from '../../domain/models';
import { DomainError } from '../../domain/error';
import { validateEstimate } from '../../domain/quote';
import { JsonHttpClient } from './http';
const money = z.string().regex(/^(0|[1-9]\d*)$/).max(19);
export const fareSchema = z.object({ currency: z.literal('VND'), amount: money, breakdown: z.array(z.object({ code: z.string().trim().min(1).max(100), amount: money }).strict()).min(1).max(100) }).strict();
export class PricingClient implements PricingPort {
  constructor(private readonly http: JsonHttpClient) {}
  async estimate(route: RouteSummary, vehicleType: string, requestId: string): Promise<QuoteFare> {
    try { const fare = await this.http.post('/internal/fares/estimate', { route, vehicleType }, requestId, fareSchema); validateEstimate(route, fare); return fare; }
    catch { throw new DomainError('DEPENDENCY_UNAVAILABLE'); }
  }
}
