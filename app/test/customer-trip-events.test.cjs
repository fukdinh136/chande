const {test} = require('node:test'), assert = require('node:assert/strict');
const {load} = require('../scripts/test-client.cjs');
const {TripEvents} = load('src/features/backend/trip-events.ts');
const flush = async () => {for(let i=0;i<3;i++)await new Promise(resolve=>setImmediate(resolve));};
function fixture(t, identity) {
  t.mock.timers.enable({apis: ['setTimeout', 'setInterval', 'Date'], now: 100000});
  const sockets = [], notices = [], states = []; let token = 'first-token';
  const events = new TripEvents('https://gateway.test', async () => token, url => {
    assert.equal(url, 'wss://gateway.test/ws'); const socket = {sent: [], closed: false, send(value) {this.sent.push(JSON.parse(value));}, close() {this.closed = true;}};
    sockets.push(socket); return socket;
  }, state => states.push(state), identity);
  events.subscribe(() => notices.push('invalidate')); t.after(() => events.stop());
  return {events, sockets, notices, states, token: value => {token = value;}};
}

test('Customer socket starts once, requires auth, exposes connection, reconnects with fresh token and invalidates REST', async t => {
  const f = fixture(t); let subscriptions = 0;
  const unsubscribe = f.events.subscribeConnection(() => subscriptions++);
  f.events.start(); f.events.start(); await flush(); assert.equal(f.sockets.length, 1);
  const first = f.sockets[0]; first.onopen(); assert.deepEqual(first.sent[0], {type: 'auth', token: 'first-token'});
  first.onmessage({data: JSON.stringify({type: 'trip.event', event: {version: 999}})}); assert.equal(f.notices.length, 0);
  first.onmessage({data: '{"type":"auth.ok"}'}); first.onmessage({data: '{"type":"auth.ok"}'}); assert.equal(f.notices.length, 1); assert.equal(f.events.getConnectionSnapshot(), 'connected');
  first.onmessage({data: '{"type":"trip.event","event":{"version":999}}'}); assert.equal(f.notices.length, 2);
  const lateEvent = first.onmessage, close = first.onclose; close(); close(); assert.equal(first.closed, true); assert.equal(f.events.getConnectionSnapshot(), 'retrying');
  f.token('rotated-token'); t.mock.timers.tick(5000); await flush(); assert.equal(f.sockets.length, 2);
  f.sockets[1].onopen(); assert.deepEqual(f.sockets[1].sent[0], {type: 'auth', token: 'rotated-token'});
  lateEvent({data: '{"type":"trip.event","event":{}}'}); assert.equal(f.notices.length, 2);
  f.sockets[1].onmessage({data: '{"type":"auth.ok"}'}); assert.equal(f.notices.length, 3);
  assert.ok(subscriptions >= 4); unsubscribe(); f.events.stop(); assert.equal(f.events.getConnectionSnapshot(), 'paused');
});

test('Customer socket wrong actor/role never authenticates or invalidates and cleanup cancels retry/handshake', async t => {
  let owner = 'owner-a'; const f = fixture(t, {role: 'RIDER', userId: () => owner}); f.events.start(); await flush();
  f.sockets[0].onopen(); f.sockets[0].onmessage({data: '{"type":"auth.ok","role":"DRIVER","userId":"owner-a"}'});
  assert.equal(f.notices.length, 0); assert.equal(f.sockets[0].closed, true); assert.equal(f.events.getConnectionSnapshot(), 'retrying');
  f.events.stop(); t.mock.timers.tick(60000); await flush(); assert.equal(f.sockets.length, 1);
  f.events.start(); await flush(); f.sockets[1].onopen(); f.sockets[1].onmessage({data: '{"type":"auth.ok","role":"RIDER","userId":"other-owner"}'}); assert.equal(f.notices.length, 0);
  f.events.stop(); owner = undefined; f.events.start(); await flush(); f.sockets[2].onmessage({data:'{"type":"auth.ok","role":"RIDER"}'}); assert.equal(f.notices.length, 0); assert.equal(f.sockets[2].closed, true);
});

test('Customer socket handshake deadline and missing heartbeat reconnect; stop clears every timer', async t => {
  const f = fixture(t); f.events.start(); await flush();
  t.mock.timers.tick(10000); assert.equal(f.sockets[0].closed, true); assert.equal(f.events.getConnectionSnapshot(), 'retrying');
  t.mock.timers.tick(5000); await flush(); assert.equal(f.sockets.length, 2);
  const socket = f.sockets[1]; socket.onopen(); socket.onmessage({data: '{"type":"auth.ok"}'});
  t.mock.timers.tick(25000); assert.equal(socket.sent.filter(value => value.type === 'ping').length, 1);
  socket.onmessage({data: '{"type":"pong"}'}); t.mock.timers.tick(75000); assert.equal(socket.closed, true);
  f.events.stop(); const count = f.sockets.length; t.mock.timers.tick(120000); await flush(); assert.equal(f.sockets.length, count); assert.equal(f.events.getConnectionSnapshot(), 'paused');
});

test('Customer socket old token acquisition cannot open a socket after owner cleanup', async t => {
  let resolve, calls = 0; const events = new TripEvents('https://gateway.test', () => new Promise(done => {resolve = done;}), () => {calls++; throw Error('stale');});
  t.after(() => events.stop()); events.start(); events.stop(); resolve('old-owner-token'); await flush(); assert.equal(calls, 0); assert.equal(events.getConnectionSnapshot(), 'paused');
});
