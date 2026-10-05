import { DomainError } from './error';
export const STATUSES = ['CREATED', 'SEARCHING', 'ASSIGNED', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type TripStatus = typeof STATUSES[number];
export type TripAction = 'SEARCH' | 'ASSIGN' | 'ARRIVE' | 'START' | 'COMPLETE' | 'CANCEL';
export const ACTIVE_STATUSES: readonly TripStatus[] = STATUSES.slice(0, 5);
const transitions: Record<TripAction, Partial<Record<TripStatus, TripStatus>>> = {
  SEARCH: { CREATED: 'SEARCHING' }, ASSIGN: { SEARCHING: 'ASSIGNED' },
  ARRIVE: { ASSIGNED: 'DRIVER_ARRIVED' }, START: { DRIVER_ARRIVED: 'IN_PROGRESS' },
  COMPLETE: { IN_PROGRESS: 'COMPLETED' },
  CANCEL: { CREATED: 'CANCELLED', SEARCHING: 'CANCELLED', ASSIGNED: 'CANCELLED', DRIVER_ARRIVED: 'CANCELLED' },
};
export function nextStatus(status: TripStatus, action: TripAction): TripStatus {
  const next = transitions[action][status];
  if (!next) throw new DomainError('INVALID_TRANSITION');
  return next;
}
