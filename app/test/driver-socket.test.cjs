const { test } = require('node:test'), assert = require('node:assert/strict');
const { loader, flush, owner, ids, tokens, memoryStorage } = require('./helpers/driver.cjs');
function socketBoundary() {
  const sockets = [];
  const io = (url, options) => {
    const handlers = new Map();
    const socket = { url, options, connected: false, active: false, connects: 0, disconnects: 0, authReplies: [],
      on: (event, fn) => { const list = handlers.get(event) ?? []; list.push(fn); handlers.set(event, list); },
      trigger: (event, ...args) => { for (const fn of [...(handlers.get(event) ?? [])]) fn(...args); },
      removeAllListeners: () => handlers.clear(), disconnect: () => { socket.disconnects++; socket.connected = false; socket.active = false; },
      connect: () => { socket.connects++; options.auth(value => socket.authReplies.push(value)); }, handlers };
    sockets.push(socket); return socket;
  };
  return { io, sockets };
}
test('Driver GPS and offer leases share one authenticated Socket.IO instance; releasing one keeps the other', async () => {
  const boundary = socketBoundary(), session = owner(), load = loader({ 'socket.io-client': boundary }), { DriverSocket } = load('src/features/driver/realtime/driver-socket.ts');
  const connection = new DriverSocket('http://realtime.test', session), events = []; connection.subscribeEvents(e => events.push(e));
  const gps = connection.acquire(), offers = connection.acquire(); await flush(); assert.equal(boundary.sockets.length, 1);
  const socket = boundary.sockets[0]; assert.equal(socket.url, 'http://realtime.test/realtime'); assert.equal(socket.options.path, '/socket.io/'); assert.equal(socket.authReplies[0].token, 'test-access');
  socket.connected = true; socket.trigger('connect'); socket.trigger('driver.trip.offer'); gps(); assert.equal(socket.disconnects, 0);
  socket.trigger('connect'); assert.equal(socket.handlers.get('driver.trip.offer').length, 1); assert.equal(events.filter(e => e === 'offer-invalidated').length, 1);
  session.change(ids.other); socket.trigger('driver.trip.offer'); assert.equal(events.filter(e => e === 'offer-invalidated').length, 1); assert.equal(socket.disconnects, 1); offers(); connection.dispose();
});
test('Driver socket handshake joins refresh without recursive re-auth or duplicate rotations', async t => {
  const boundary = socketBoundary(), load = loader({ 'socket.io-client': boundary }), { SessionManager } = load('src/features/driver/session/session-manager.ts'), { DriverSocket } = load('src/features/driver/realtime/driver-socket.ts'); let rotations = 0;
  const session = new SessionManager({ verifyOtp: async () => tokens({ expiresIn: 1 }), refresh: async () => { rotations++; return tokens({ accessToken: 'next-access' }); }, logout: async () => {} }, {}, memoryStorage());
  await session.login('p', 'c', '123456'); const connection = new DriverSocket('http://realtime.test', session); t.after(() => { connection.dispose(); session.dispose(); });
  const release = connection.acquire(); await flush(); assert.equal(rotations, 1); assert.equal(boundary.sockets.length, 2);
  assert.deepEqual(boundary.sockets[0].authReplies, []); assert.deepEqual(boundary.sockets[1].authReplies, [{ token: 'next-access' }]); release();
});
test('Driver socket server disconnect backs off with one listener set and stops retries after release', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 });
  const boundary = socketBoundary(), load = loader({ 'socket.io-client': boundary }), { DriverSocket } = load('src/features/driver/realtime/driver-socket.ts'), connection = new DriverSocket('http://realtime.test', owner());
  const release = connection.acquire(); const socket = boundary.sockets[0]; socket.trigger('disconnect', 'io server disconnect'); socket.trigger('disconnect', 'io server disconnect');
  t.mock.timers.tick(999); assert.equal(socket.connects, 1); t.mock.timers.tick(1); assert.equal(socket.connects, 2); socket.trigger('disconnect', 'io server disconnect'); release(); t.mock.timers.tick(60000); assert.equal(socket.connects, 2); connection.dispose(); await flush();
});
test('Driver location adapter rejects mismatched ACK and cancels pending send at stop', async () => {
  const { SocketLocationClient } = loader()('src/features/driver/gps/socket-location-client.ts'); let reply, released = 0;
  const socket = { get volatile() { return this; }, timeout: () => socket, emit: (_, __, cb) => { reply = cb; } }, connection = { subscribe: () => () => {}, acquire: () => () => { released++; }, retry: () => {}, getState: () => 'connected', getCode: () => null, connectedSocket: () => socket, current: () => true };
  const client = new SocketLocationClient(connection, () => {}, () => {}); client.start();
  const payload = { latitude: 21, longitude: 105, accuracy: 5, recordedAt: new Date().toISOString() };
  const bad = assert.rejects(client.send(payload), /INVALID_ACK/); reply(null, { data: { accepted: true, recordedAt: 'old', receivedAt: new Date().toISOString(), disposition: 'STORED' } }); await bad;
  const stopped = assert.rejects(client.send(payload), /GPS_STOPPED/); client.stop(); await stopped; reply(null, { data: { accepted: true, ...payload, receivedAt: new Date().toISOString(), disposition: 'STORED' } }); assert.equal(released, 1);
});
test('Driver Trip notification handshake is single-flight; expiry reconnects with SessionManager, owner cleanup stops timers', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 10000 });
  const sockets = [];
  class FakeWebSocket {
    static OPEN = 1;
    constructor(url) { this.url = url; this.readyState = 1; this.sent = []; sockets.push(this); }
    send(value) { this.sent.push(JSON.parse(value)); }
    close() { this.closed = true; }
  }
  t.mock.property(globalThis, 'WebSocket', FakeWebSocket);
  const { DriverTripNotifications } = loader()('src/features/driver/realtime/trip-notifications.ts'), session = owner(); let invalidations = 0;
  const notifications = new DriverTripNotifications('http://gateway.test', session, () => {}, () => { invalidations++; }); t.after(() => notifications.dispose());
  notifications.start(); notifications.start(); notifications.retry(); await flush(); assert.equal(sockets.length, 1);
  const socket = sockets[0]; assert.equal(socket.url, 'ws://gateway.test/ws'); socket.onopen(); assert.deepEqual(socket.sent[0], { type: 'auth', token: 'test-access' });
  socket.onmessage({ data: JSON.stringify({ type: 'auth.ok', role: 'DRIVER', userId: ids.driver }) }); assert.equal(invalidations, 1);
  const late = socket.onmessage; socket.onclose({ code: 4401, reason: 'TOKEN_EXPIRED' }); t.mock.timers.tick(1000); await flush(); assert.equal(sockets.length, 2);
  session.change(ids.other); late({ data: JSON.stringify({ type: 'trip.event', event: {} }) }); t.mock.timers.tick(90000); await flush(); assert.equal(invalidations, 1); assert.equal(sockets.length, 2); assert.ok(sockets[1].closed);
});
