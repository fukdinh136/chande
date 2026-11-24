const { test } = require('node:test'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
const { armExpiry, renew } = require('../dist/presentation/socket/guards/driver-socket.guard');
// B5: a newer JWT on the open socket moves its expiry instead of closing it.
test('renew keeps the socket open for the same driver and moves the expiry timer', async () => {
  const driverId = randomUUID(), state = { identity: { driverId, expiresAt: Date.now() + 40 } };
  let closed = 0; armExpiry(state, () => closed++);
  renew(state, { driverId, expiresAt: Date.now() + 10000 }); armExpiry(state, () => closed++);
  await new Promise(r => setTimeout(r, 80)); assert.equal(closed, 0, 'the old expiry no longer closes the socket');
  assert.throws(() => renew(state, { driverId: randomUUID(), expiresAt: Date.now() + 10000 }), { code: 'FORBIDDEN' });
  assert.throws(() => renew(state, { driverId, expiresAt: Date.now() - 1 }), { code: 'UNAUTHENTICATED' });
  clearTimeout(state.expiryTimer);
  const expired = { identity: { driverId, expiresAt: Date.now() - 1 } };
  assert.throws(() => renew(expired, { driverId, expiresAt: Date.now() + 10000 }), { code: 'UNAUTHENTICATED' }, 'an expired socket must reconnect');
  const short = { identity: { driverId, expiresAt: Date.now() + 20 } }; armExpiry(short, () => closed++);
  await new Promise(r => setTimeout(r, 60)); assert.equal(closed, 1, 'without renewal the socket still closes at expiry');
});
