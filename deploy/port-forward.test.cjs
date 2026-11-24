const {test} = require('node:test'), assert = require('node:assert/strict'), http = require('node:http');
const {gatewayReady, ensurePortForward} = require('./port-forward.cjs');
async function server(status, body, work) {
  const listener = http.createServer((request, response) => {
    assert.equal(request.url, '/api/v1/trips/active');
    response.writeHead(status, {'Content-Type': 'application/json'}); response.end(JSON.stringify(body));
  });
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  try { await work('http://127.0.0.1:' + listener.address().port); }
  finally { await new Promise(resolve => listener.close(resolve)); }
}
const auth = {error: {code: 'UNAUTHENTICATED'}, meta: {requestId: 'test-request'}};
test('forward readiness requires the real Gateway auth contract, not ingress liveness', async () => {
  await server(401, auth, async base => assert.equal(await gatewayReady(base), true));
  for (const [status, body] of [[200, auth], [401, {error: auth.error}], [401, {error: {code: 'OTHER'}, meta: auth.meta}]]) {
    await server(status, body, async base => assert.equal(await gatewayReady(base), false));
  }
});
test('a verified existing Gateway is reused regardless of stale or missing PID files', async () => {
  await server(401, auth, async base => { await ensurePortForward({base}); });
});
test('an occupied port with another endpoint is refused without replacing its process', async () => {
  await server(200, {ok: true}, async base => {
    await assert.rejects(ensurePortForward({base}), /does not expose the expected Gateway/);
    assert.equal((await fetch(base + '/api/v1/trips/active')).status, 200);
  });
});
