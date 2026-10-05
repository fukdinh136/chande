import type { Principal } from '../../domain/models';
import { DomainError } from '../../domain/error';
import { Trip } from '../../domain/trip';
import type { Store } from '../ports/store';
import type { Runtime } from '../ports/clients';
import { enqueueEvent, enqueueMatching, idempotent } from './shared';
export class CancelTrip {
  constructor(private readonly store: Store, private readonly runtime: Runtime) {}
  execute(principal: Principal, id: string, reason: string, version: number, key: string) {
    const normalized = reason.trim();
    return idempotent(this.store, principal, key, { operation: 'POST /trips/:id/cancel', id, reason: normalized, version }, async tx => {
      const data = await tx.findTrip(id, true); if (!data) throw new DomainError('RESOURCE_NOT_FOUND');
      const at = this.runtime.now(); const transition = Trip.restore(data).cancel(principal, normalized, version, at); const next = transition.trip.snapshot();
      await tx.saveTrip(next, data.version); await tx.addHistory(id, [transition.history]); await enqueueMatching(tx, next, this.runtime, at, 'cancel'); await enqueueEvent(tx, next, this.runtime, at); return next;
    });
  }
}
