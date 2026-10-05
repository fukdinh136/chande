import { createHash } from 'node:crypto';
import { DomainError } from '../../domain/error';
import type { Principal, TripData } from '../../domain/models';
import type { Runtime } from '../ports/clients';
import type { Store, Transaction } from '../ports/store';
export interface Result<T> { value: T; replayed: boolean }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export function requestHash(value: unknown): string { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
export async function idempotent<T>(store: Store, principal: Principal, key: string, input: unknown, work: (tx: Transaction) => Promise<T>): Promise<Result<T>> {
  const scope = `${principal.role}:${principal.sub}:${key}`; const hash = requestHash(input);
  return store.transaction(async tx => {
    await tx.lockReceipt(scope); const previous = await tx.receipt<T>(scope);
    if (previous) { if (previous.hash !== hash) throw new DomainError('IDEMPOTENCY_KEY_REUSED'); return { value: previous.result, replayed: true }; }
    const value = await work(tx); await tx.saveReceipt(scope, hash, value); return { value, replayed: false };
  });
}
const eventTypes: Record<string, string> = { SEARCHING: 'trip.searching', ASSIGNED: 'trip.assigned', DRIVER_ARRIVED: 'trip.driver_arrived', IN_PROGRESS: 'trip.started', COMPLETED: 'trip.completed', CANCELLED: 'trip.cancelled' };
export async function enqueueEvent(tx: Transaction, data: TripData, runtime: Runtime, at: Date): Promise<void> {
  const id = runtime.id();
  await tx.enqueue({ id, tripId: data.tripId, tripVersion: data.version, kind: 'event', payload: { schemaVersion: 1, eventId: id, type: eventTypes[data.status], tripId: data.tripId, tripVersion: data.version, occurredAt: at.toISOString(), data: { riderId: data.riderId, driverId: data.driverId, status: data.status } } }, data.status === 'COMPLETED' ? ['gateway', 'notification', 'matching'] : ['gateway', 'notification']);
}
export async function enqueueMatching(tx: Transaction, data: TripData, runtime: Runtime, at: Date, kind: 'search' | 'cancel'): Promise<void> {
  const id = runtime.id();
  const payload: Record<string, unknown> = { commandId: id, type: kind === 'search' ? 'matching.search.requested' : 'matching.search.cancelled', tripId: data.tripId, tripVersion: data.version, occurredAt: at.toISOString() };
  if (kind === 'search') Object.assign(payload, { riderId: data.riderId, pickup: data.pickup, destination: data.destination, vehicleType: data.vehicleType, route: data.route, fare: { currency: 'VND', amount: data.fare.estimatedAmount } });
  else payload.reason = data.cancellation?.reason;
  await tx.enqueue({ id, tripId: data.tripId, tripVersion: data.version, kind, payload }, ['matching']);
}
