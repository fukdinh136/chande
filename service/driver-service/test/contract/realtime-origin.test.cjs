const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');

test('Driver disposable Realtime ingress admits Android Origin, rejects unknown Origin and still requires Driver JWT', {
  skip: process.env.DRIVER_REALTIME_ORIGIN_PROBE !== '1', timeout: 15000,
}, async t => {
  const base = process.env.APP_BACKEND_URL;
  assert.equal(base, 'http://127.0.0.1:18082'); // No discovery or team environment.
  const appRequire = createRequire(path.resolve(__dirname, '../../../../app/package.json'));
  const WebSocket = appRequire('ws'), { io } = appRequire('socket.io-client');
  const handshake = origin => new Promise((resolve, reject) => {
    const socket = new WebSocket(base.replace(/^http/, 'ws') + '/socket.io/?EIO=4&transport=websocket', { headers: { Origin: origin }, handshakeTimeout: 5000 });
    const timer = setTimeout(() => { socket.terminate(); reject(Error('Engine.IO probe timed out')); }, 6000);
    socket.once('unexpected-response', (_, response) => {
      let body = ''; response.setEncoding('utf8');
      response.on('data', chunk => { body = (body + chunk).slice(0, 256); });
      response.once('end', () => { clearTimeout(timer); resolve({ status: response.statusCode, body }); socket.terminate(); });
      response.resume();
    });
    socket.once('message', data => { clearTimeout(timer); socket.close(); assert.ok(data.toString().startsWith('0{')); resolve({ status: 101 }); });
    socket.once('error', error => { clearTimeout(timer); reject(error); });
  });
  assert.equal((await handshake(base)).status, 101, 'Android endpoint Origin must reach Engine.IO');
  // Engine.IO abortUpgrade deliberately uses HTTP 400 even for FORBIDDEN;
  // assert its reason too, so an unrelated gateway failure cannot pass.
  const denied = await handshake('https://untrusted.example');
  assert.equal(denied.status, 400, 'Unknown Origin must remain blocked');
  assert.equal(denied.body, 'Forbidden');
  const socket = io(base + '/realtime', { path: '/socket.io/', transports: ['websocket'], extraHeaders: { Origin: base }, auth: {}, autoConnect: false, reconnection: false, forceNew: true, timeout: 5000 });
  t.after(() => { socket.removeAllListeners(); socket.disconnect(); });
  const rejection = await new Promise((resolve, reject) => {
    socket.once('connect', () => reject(Error('Unauthenticated Driver unexpectedly connected')));
    socket.once('connect_error', error => resolve(error.data?.code));
    socket.connect();
  });
  assert.equal(rejection, 'UNAUTHENTICATED', 'Origin admission must not bypass JWT verification');
});
