import { offer, type Offer } from '../../backend/clients';
import { id, record } from '../../backend/http';
import { ApiError } from '../http/errors';

export type OfferAction = 'accept' | 'decline';
export interface OfferReceipt { offerId: string; status: 'ASSIGNMENT_PENDING' | 'DECLINED'; accepted: boolean }
// version is an observation, NOT a Matching request field. Matching accepts body {}.
export interface OfferDecision {
  offerId: string; tripId: string; driverId: string; version: number;
  action: OfferAction; key: string; origin: string; path: string;
  method: 'POST'; body: Record<string, never>;
}
export interface OfferJournal {
  schema: 1; driverId: string; offerId: string; snapshot: Offer | null;
  command: OfferDecision | null; receipt: OfferReceipt | null;
  closed: boolean; retryable: boolean;
  // Previous screen-owned storage did not freeze the endpoint. Reconcile only.
  legacy: { action: OfferAction; key: string } | null;
}
export function receipt(value: unknown, offerId: string, action: OfferAction): OfferReceipt {
  const data = record(value);
  if (data.offerId !== offerId || data.accepted !== (action === 'accept') || data.status !== (action === 'accept' ? 'ASSIGNMENT_PENDING' : 'DECLINED')) throw new ApiError('INVALID_RESPONSE');
  return { offerId, status: action === 'accept' ? 'ASSIGNMENT_PENDING' : 'DECLINED', accepted: action === 'accept' };
}
export function journal(value: unknown, driverId: string, offerId: string): OfferJournal {
  const data = record(value);
  if (data.schema !== 1 || data.driverId !== driverId || data.offerId !== offerId || typeof data.closed !== 'boolean' || typeof data.retryable !== 'boolean') throw new ApiError('OFFER_STORAGE_INVALID');
  const snapshot = offer(data.snapshot);
  if (snapshot && (snapshot.driverId !== driverId || snapshot.offerId !== offerId)) throw new ApiError('OFFER_STORAGE_INVALID');
  let command: OfferDecision | null = null;
  if (data.command !== null) {
    const c = record(data.command);
    if (!snapshot || c.driverId !== driverId || c.offerId !== offerId || c.tripId !== snapshot.tripId || !Number.isSafeInteger(c.version) || (c.version as number) < 1 || !['accept', 'decline'].includes(c.action as string) || c.method !== 'POST' || typeof c.origin !== 'string' || typeof c.path !== 'string' || Object.keys(record(c.body)).length) throw new ApiError('OFFER_STORAGE_INVALID');
    command = { offerId, driverId, tripId: snapshot.tripId, version: c.version as number, action: c.action as OfferAction, key: id(c.key), origin: c.origin, path: c.path, method: 'POST', body: {} };
  }
  let legacy: OfferJournal['legacy'] = null;
  if (data.legacy !== null) {
    const c = record(data.legacy);
    if (!['accept', 'decline'].includes(c.action as string)) throw new ApiError('OFFER_STORAGE_INVALID');
    legacy = { action: c.action as OfferAction, key: id(c.key) };
  }
  const received = data.receipt === null ? null : receipt(data.receipt, offerId, record(data.receipt).accepted ? 'accept' : 'decline');
  if (received && (command?.action ?? legacy?.action) && received.accepted !== ((command?.action ?? legacy?.action) === 'accept')) throw new ApiError('OFFER_STORAGE_INVALID');
  return { schema: 1, driverId, offerId, snapshot, command, receipt: received, closed: data.closed, retryable: data.retryable, legacy };
}
export const offerClosed = (value: Offer) => ['DECLINED', 'EXPIRED', 'REJECTED', 'REVOKED'].includes(value.status);
