const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const name = 'routing-smoke-' + randomUUID();
const image = process.env.ROUTING_TEST_IMAGE || 'chande-routing:local';
const tokens = { trip: randomUUID(), matching: randomUUID(), gateway: randomUUID() };
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 60000 });
  if (result.status !== 0) throw new Error('Docker smoke command failed: ' + args[0]);
  return result.stdout.trim();
}
const point = { lat: 10.77, lng: 106.69 };
async function ready(url) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    try { if ((await fetch(url + '/health/ready', { signal: AbortSignal.timeout(500) })).ok) return; } catch { /* startup */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Routing container did not become ready');
}
async function post(url, path, caller, body) {
  const response = await fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-service-token': tokens[caller] }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200); return (await response.json()).data;
}
async function main() {
  try {
    const env = { NODE_ENV: 'test', APP_ENV: 'test', HOST: '0.0.0.0', PORT: '3004', INTEGRATION_MODE: 'mock', REALTIME_INTEGRATION_MODE: 'mock', SUPPORTED_VEHICLE_TYPES: 'MOCK_BIKE', VEHICLE_PROFILES_FILE: 'config/vehicle-profiles.example.json', ROUTING_TRIP_TOKEN: tokens.trip, ROUTING_MATCHING_TOKEN: tokens.matching, ROUTING_GATEWAY_TOKEN: tokens.gateway, SHUTDOWN_GRACE_MS: '1000', RATE_LIMIT_REQUESTS_PER_SECOND: '1000', RATE_LIMIT_BURST: '100' };
    docker(['run', '-d', '--name', name, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '-p', '127.0.0.1::3004', ...Object.entries(env).flatMap(([k, v]) => ['-e', k + '=' + v]), image]);
    let url = 'http://' + docker(['port', name, '3004/tcp']); await ready(url);
    const input = { pickup: point, destination: point, vehicleType: 'MOCK_BIKE' };
    assert.deepEqual(await post(url, '/internal/routes/estimate', 'trip', input), { distanceMeters: 4000, durationSeconds: 600 });
    assert.ok((await post(url, '/routes', 'gateway', { origin: point, destination: point, vehicleType: 'MOCK_BIKE' })).polyline.value);
    const matrix = await post(url, '/routes/matrix', 'matching', { pickup: point, vehicleType: 'MOCK_BIKE' }); assert.equal(matrix.radiusMeters, 2000); assert.equal(matrix.entries.length, 2);
    assert.ok((await post(url, '/routes/recalculate', 'gateway', { currentLocation: point, destination: point, vehicleType: 'MOCK_BIKE' })).polyline.value);
    const started = performance.now();
    const burst = await Promise.all(Array.from({ length: 20 }, () => post(url, '/internal/routes/estimate', 'trip', input)));
    assert.equal(burst.length, 20); console.log('Mock smoke: four routes and 20 concurrent estimates passed in ' + Math.ceil(performance.now() - started) + ' ms (not OSRM capacity).');
    docker(['restart', '--time', '10', name]); url = 'http://' + docker(['port', name, '3004/tcp']); await ready(url); assert.deepEqual(await post(url, '/internal/routes/estimate', 'trip', input), { distanceMeters: 4000, durationSeconds: 600 });
    const stopped = performance.now(); docker(['stop', '--time', '10', name]);
    const exit = Number(docker(['inspect', '--format', '{{.State.ExitCode}}', name])); assert.ok([0, 143].includes(exit), 'container must not be killed by SIGKILL');
    console.log('Linux restart/SIGTERM passed; stop ' + Math.ceil(performance.now() - stopped) + ' ms, exit ' + exit + '.');
  } finally { spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore', timeout: 10000 }); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
