import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATUSES, nextStatus, type TripAction } from '../../src/domain/state-machine';
const actions: TripAction[] = ['SEARCH', 'ASSIGN', 'ARRIVE', 'START', 'COMPLETE', 'CANCEL'];
const allowed = new Map<string, string>([
  ['CREATED:SEARCH', 'SEARCHING'], ['SEARCHING:ASSIGN', 'ASSIGNED'], ['ASSIGNED:ARRIVE', 'DRIVER_ARRIVED'],
  ['DRIVER_ARRIVED:START', 'IN_PROGRESS'], ['IN_PROGRESS:COMPLETE', 'COMPLETED'],
  ...['CREATED', 'SEARCHING', 'ASSIGNED', 'DRIVER_ARRIVED'].map(s => [`${s}:CANCEL`, 'CANCELLED'] as const),
]);
for (const status of STATUSES) for (const action of actions) {
  test(`state machine ${status} + ${action}`, () => {
    const expected = allowed.get(`${status}:${action}`);
    if (expected) assert.equal(nextStatus(status, action), expected);
    else assert.throws(() => nextStatus(status, action), { code: 'INVALID_TRANSITION' });
  });
}
