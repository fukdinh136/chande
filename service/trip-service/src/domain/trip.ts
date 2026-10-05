import { DomainError } from './error';
import type { Actor, Assignment, HistoryEntry, Principal, Quote, TripData } from './models';
import { assertUsableQuote, validateEstimate } from './quote';
import { nextStatus, type TripAction } from './state-machine';

export class Trip {
  private constructor(private readonly data: TripData) {}
  static restore(data: TripData): Trip { return new Trip(structuredClone(data)); }
  static create(id: string, quote: Quote, riderId: string, now: Date): Trip {
    assertUsableQuote(quote, riderId, now); validateEstimate(quote.route, quote.fare);
    return new Trip({
      tripId: id, quoteId: quote.quoteId, riderId, driverId: null, vehicleId: null, status: 'CREATED', version: 0,
      pickup: structuredClone(quote.pickup), destination: structuredClone(quote.destination), vehicleType: quote.vehicleType,
      route: structuredClone(quote.route), fare: { currency: 'VND', estimatedAmount: quote.fare.amount, finalAmount: null, breakdown: structuredClone(quote.fare.breakdown) },
      driver: null, vehicle: null, timestamps: { requestedAt: now.toISOString(), assignedAt: null, driverArrivedAt: null, startedAt: null, completedAt: null, cancelledAt: null }, cancellation: null,
    });
  }
  snapshot(): TripData { return structuredClone(this.data); }
  canRead(principal: Principal): boolean {
    return principal.role === 'RIDER' ? this.data.riderId === principal.sub : this.data.driverId === principal.sub;
  }
  requireRead(principal: Principal): void { if (!this.canRead(principal)) throw new DomainError('RESOURCE_NOT_FOUND'); }
  requireVersion(version: number): void { if (version !== this.data.version) throw new DomainError('VERSION_CONFLICT'); }
  initialHistory(now: Date): HistoryEntry { return { fromStatus: null, toStatus: 'CREATED', actorType: 'SYSTEM', actorId: null, occurredAt: now.toISOString(), version: 0 }; }
  private transition(action: TripAction, actor: Actor, now: Date): { trip: Trip; history: HistoryEntry } {
    const data = this.snapshot(); const previous = data.status;
    data.status = nextStatus(data.status, action); data.version++;
    return { trip: new Trip(data), history: { fromStatus: previous, toStatus: data.status, actorType: actor.type, actorId: actor.id, occurredAt: now.toISOString(), version: data.version } };
  }
  search(now: Date): { trip: Trip; history: HistoryEntry } { return this.transition('SEARCH', { type: 'SYSTEM', id: null }, now); }
  assign(assignment: Assignment, now: Date): { trip: Trip; history: HistoryEntry } {
    if (this.data.status !== 'SEARCHING') throw new DomainError(this.data.driverId ? 'TRIP_ALREADY_ASSIGNED' : 'TRIP_NOT_SEARCHING');
    if (assignment.vehicleSnapshot.vehicleType !== this.data.vehicleType) throw new DomainError('INVALID_REQUEST');
    const result = this.transition('ASSIGN', { type: 'SYSTEM', id: null }, now);
    const data = result.trip.data;
    data.driverId = assignment.driverId; data.vehicleId = assignment.vehicleId;
    data.driver = { ...structuredClone(assignment.driverSnapshot), driverId: assignment.driverId };
    data.vehicle = { ...structuredClone(assignment.vehicleSnapshot), vehicleId: assignment.vehicleId };
    data.timestamps.assignedAt = now.toISOString();
    return result;
  }
  update(principal: Principal, status: 'DRIVER_ARRIVED' | 'IN_PROGRESS' | 'COMPLETED', version: number, now: Date): { trip: Trip; history: HistoryEntry } {
    this.requireRead(principal);
    if (principal.role !== 'DRIVER') throw new DomainError('FORBIDDEN_ACTION');
    this.requireVersion(version);
    const action = { DRIVER_ARRIVED: 'ARRIVE', IN_PROGRESS: 'START', COMPLETED: 'COMPLETE' } as const;
    const result = this.transition(action[status], { type: principal.role, id: principal.sub }, now);
    const data = result.trip.data;
    if (status === 'DRIVER_ARRIVED') data.timestamps.driverArrivedAt = now.toISOString();
    if (status === 'IN_PROGRESS') data.timestamps.startedAt = now.toISOString();
    if (status === 'COMPLETED') { data.timestamps.completedAt = now.toISOString(); data.fare.finalAmount = data.fare.estimatedAmount; }
    return result;
  }
  cancel(principal: Principal, reason: string, version: number, now: Date): { trip: Trip; history: HistoryEntry } {
    this.requireRead(principal); this.requireVersion(version);
    const trimmed = reason.trim(); if (!trimmed || trimmed.length > 500) throw new DomainError('INVALID_REQUEST');
    const result = this.transition('CANCEL', { type: principal.role, id: principal.sub }, now);
    result.trip.data.timestamps.cancelledAt = now.toISOString();
    result.trip.data.cancellation = { actorType: principal.role, actorId: principal.sub, reason: trimmed, cancelledAt: now.toISOString() };
    return result;
  }
}
