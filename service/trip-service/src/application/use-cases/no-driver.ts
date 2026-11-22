import { DomainError } from '../../domain/error';
import { Trip } from '../../domain/trip';
import type { Store } from '../ports/store';
import type { Runtime } from '../ports/clients';
import { enqueueEvent, enqueueMatching, requestHash, type Result } from './shared';
export interface NoDriverAck { eventId: string; tripId: string; accepted: true; cancelledVersion: number }
/**
 * Matching's search reached its deadline with no driver (ADR-0004). Cancels the trip as SYSTEM with reason
 * NO_DRIVER_FOUND, idempotent on `eventId` through the inbox like an assignment. Matching is told to stop like any
 * other cancel, and the trip.cancelled event reaches the rider.
 */
export class NoDriverFound {
  constructor(private readonly store: Store, private readonly runtime: Runtime) {}
  execute(tripId: string, eventId: string): Promise<Result<NoDriverAck>> {
    const hash = requestHash({ tripId, eventId, kind: 'no-driver-found' });
    return this.store.transaction(async tx => {
      await tx.lockInbox(eventId); const prior = await tx.inbox<NoDriverAck>(eventId);
      if (prior) { if (prior.hash !== hash) throw new DomainError('EVENT_ID_REUSED'); return { value: prior.result, replayed: true }; }
      const data = await tx.findTrip(tripId, true); if (!data) throw new DomainError('RESOURCE_NOT_FOUND');
      const at = this.runtime.now(); const transition = Trip.restore(data).noDriverFound(at); const next = transition.trip.snapshot();
      await tx.saveTrip(next, data.version); await tx.addHistory(tripId, [transition.history]);
      await enqueueMatching(tx, next, this.runtime, at, 'cancel'); await enqueueEvent(tx, next, this.runtime, at);
      const value: NoDriverAck = { eventId, tripId, accepted: true, cancelledVersion: next.version };
      await tx.saveInbox(eventId, hash, value); return { value, replayed: false };
    });
  }
}
