import type { Principal, TripData } from '../../domain/models';
import { DomainError } from '../../domain/error';
import { Trip } from '../../domain/trip';
import type { Store } from '../ports/store';
import type { Runtime } from '../ports/clients';
import { enqueueEvent, enqueueMatching, idempotent, type Result } from './shared';
export class CreateTrip {
  constructor(private readonly store: Store, private readonly runtime: Runtime) {}
  execute(principal: Principal, quoteId: string, key: string): Promise<Result<TripData>> {
    if (principal.role !== 'RIDER') throw new DomainError('FORBIDDEN_ACTION');
    return idempotent(this.store, principal, key, { operation: 'POST /trips', quoteId }, async tx => {
      const quote = await tx.findQuote(quoteId, true); if (!quote) throw new DomainError('RESOURCE_NOT_FOUND');
      const at = this.runtime.now(); const initial = Trip.create(this.runtime.id(), quote, principal.sub, at);
      if (await tx.active(principal)) throw new DomainError('ACTIVE_TRIP_EXISTS');
      const result = initial.search(at); const data = result.trip.snapshot();
      await tx.saveTrip(data); await tx.consumeQuote(quoteId, data.tripId);
      await tx.addHistory(data.tripId, [initial.initialHistory(at), result.history]);
      await enqueueMatching(tx, data, this.runtime, at, 'search'); await enqueueEvent(tx, data, this.runtime, at);
      return data;
    });
  }
}
