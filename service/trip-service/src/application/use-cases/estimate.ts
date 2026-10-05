import type { Location, Principal, Quote } from '../../domain/models';
import { DomainError } from '../../domain/error';
import { validateEstimate } from '../../domain/quote';
import type { Store } from '../ports/store';
import type { PricingPort, RoutingPort, Runtime } from '../ports/clients';
export interface EstimateInput { pickup: Location; destination: Location; vehicleType: string }
export class EstimateTrip {
  constructor(private readonly store: Store, private readonly routing: RoutingPort, private readonly pricing: PricingPort, private readonly runtime: Runtime, private readonly vehicleTypes: string[]) {}
  async execute(principal: Principal, input: EstimateInput, requestId: string): Promise<Omit<Quote, 'riderId' | 'consumedTripId'>> {
    if (principal.role !== 'RIDER') throw new DomainError('FORBIDDEN_ACTION');
    if (!this.vehicleTypes.includes(input.vehicleType)) throw new DomainError('INVALID_REQUEST');
    for (const point of [input.pickup, input.destination]) if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng) || Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) throw new DomainError('INVALID_REQUEST');
    const route = await this.routing.estimate(input.pickup, input.destination, input.vehicleType, requestId);
    const fare = await this.pricing.estimate(route, input.vehicleType, requestId); validateEstimate(route, fare);
    const now = this.runtime.now();
    const quote: Quote = { ...structuredClone(input), quoteId: this.runtime.id(), riderId: principal.sub, route, fare, createdAt: now.toISOString(), expiresAt: new Date(+now + 300000).toISOString(), consumedTripId: null };
    await this.store.transaction(tx => tx.saveQuote(quote));
    const { riderId: _owner, consumedTripId: _used, ...response } = quote;
    void _owner; void _used; return response;
  }
}
