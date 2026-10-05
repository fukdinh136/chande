import type { Principal } from '../../domain/models';
import { DomainError } from '../../domain/error';
import { Trip } from '../../domain/trip';
import type { Store } from '../ports/store';
import type { Runtime } from '../ports/clients';
import { enqueueEvent, idempotent } from './shared';
export class UpdateTrip {
  constructor(private readonly store: Store, private readonly runtime: Runtime) {}
  execute(principal: Principal, id: string, status: 'DRIVER_ARRIVED' | 'IN_PROGRESS' | 'COMPLETED', version: number, key: string) {
    return idempotent(this.store, principal, key, { operation: 'PATCH /trips/:id/status', id, status, version }, async tx => {
      const data = await tx.findTrip(id, true); if (!data) throw new DomainError('RESOURCE_NOT_FOUND');
      const at = this.runtime.now(); const transition = Trip.restore(data).update(principal, status, version, at); const next = transition.trip.snapshot();
      await tx.saveTrip(next, data.version); await tx.addHistory(id, [transition.history]); await enqueueEvent(tx, next, this.runtime, at); return next;
    });
  }
}
