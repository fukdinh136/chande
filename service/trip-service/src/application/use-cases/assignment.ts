import type { Assignment } from '../../domain/models';
import { DomainError } from '../../domain/error';
import { Trip } from '../../domain/trip';
import type { Store } from '../ports/store';
import type { Runtime } from '../ports/clients';
import { enqueueEvent, requestHash, type Result } from './shared';
export interface AssignmentAck { eventId: string; tripId: string; accepted: true; assignedVersion: number }
export class ReceiveAssignment {
  constructor(private readonly store: Store, private readonly runtime: Runtime) {}
  execute(tripId: string, assignment: Assignment): Promise<Result<AssignmentAck>> {
    const hash = requestHash({ tripId, assignment });
    return this.store.transaction(async tx => {
      await tx.lockInbox(assignment.eventId); const prior = await tx.inbox<AssignmentAck>(assignment.eventId);
      if (prior) { if (prior.hash !== hash) throw new DomainError('EVENT_ID_REUSED'); return { value: prior.result, replayed: true }; }
      const data = await tx.findTrip(tripId, true); if (!data) throw new DomainError('RESOURCE_NOT_FOUND');
      const at = this.runtime.now(); const transition = Trip.restore(data).assign(assignment, at);
      if (await tx.active({ role: 'DRIVER', sub: assignment.driverId })) throw new DomainError('DRIVER_HAS_ACTIVE_TRIP');
      const next = transition.trip.snapshot(); await tx.saveTrip(next, data.version); await tx.addHistory(tripId, [transition.history]); await enqueueEvent(tx, next, this.runtime, at);
      const value: AssignmentAck = { eventId: assignment.eventId, tripId, accepted: true, assignedVersion: next.version };
      await tx.saveInbox(assignment.eventId, hash, value); return { value, replayed: false };
    });
  }
}
