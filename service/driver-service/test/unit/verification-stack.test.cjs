const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');
const script = path.resolve(__dirname, '../../scripts/verification-stack.cjs');
const topology = require('../../../../deploy/stack.cjs');

function generated(port) {
  const files = new Map();
  const fakeFs = {
    existsSync: file => String(file).endsWith('hanoi.osrm.partition'),
    mkdirSync() {}, copyFileSync() {},
    writeFileSync: (file, data) => files.set(path.basename(file), String(data)),
  };
  vm.runInNewContext(fs.readFileSync(script, 'utf8'), {
    __dirname: path.dirname(script), console: { info() {} },
    process: { env: { DRIVER_TEST_STORAGE_ACK: 'ISOLATED_DRIVER_TEST_ONLY', ...(port ? { DRIVER_TEST_INGRESS_PORT: String(port) } : {}) } },
    require: id => id === 'node:fs' ? fakeFs : id === '../../../deploy/stack.cjs' ? topology : id === 'node:crypto' ? {
      randomBytes: () => Buffer.alloc(32, 1),
      generateKeyPairSync: () => ({ privateKey: { export: () => 'test-only-key' } }),
    } : require(id),
  });
  return { compose: JSON.parse(files.get('compose.json')), realtime: Object.fromEntries(files.get('realtime-api.env').trim().split('\n').map(line => {
    const split = line.indexOf('='); return [line.slice(0, split), line.slice(split + 1)];
  })) };
}

// Read the actual Realtime allowRequest implementation; replace only Nest's
// server creation boundary. No Realtime source, network or database is changed.
function allowed(origins, origin) {
  const file = path.join(topology.root, 'service/realtime-service/src/bootstrap/socket.adapter.ts');
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', code)(id => id === '@nestjs/platform-socket.io' ? {
    IoAdapter: class { createIOServer(_, options) { return options; } },
  } : require(id), module, module.exports);
  const options = new module.exports.RealtimeSocketAdapter({}, origins).createIOServer(3006);
  let accepted;
  options.allowRequest({ headers: origin === undefined ? {} : { origin } }, (error, value) => { assert.equal(error, null); accepted = value; });
  return accepted;
}

test('Driver verification Realtime accepts Android default WebSocket origins and local browser origins', () => {
  const { compose, realtime } = generated(), origins = (realtime.SOCKET_CORS_ORIGINS ?? '').split(',');
  // React Native Android's default Origin is the WS endpoint converted to HTTP;
  // it is not the Metro origin. Exercise both adb reverse and emulator routing.
  for (const origin of ['http://127.0.0.1:18082', 'http://localhost:18082', 'http://10.0.2.2:18082', 'http://localhost:8081', 'http://127.0.0.1:8081', 'http://localhost:5500', 'http://127.0.0.1:5500']) {
    assert.equal(allowed(origins, origin), true, origin);
  }
  assert.equal(realtime.PORT, '3006');
  assert.equal(realtime.AUTH_JWT_AUDIENCE, 'realtime-service');
  assert.equal(realtime.AUTH_JWT_ISSUER, 'chande-driver-local');
  assert.deepEqual(compose.services.edge.ports, ['127.0.0.1:18082:8088']);
});

test('Driver verification origin policy follows its own ingress port and rejects unrelated origins', () => {
  const { realtime } = generated(19082), origins = (realtime.SOCKET_CORS_ORIGINS ?? '').split(',');
  assert.equal(allowed(origins, 'http://127.0.0.1:19082'), true);
  for (const origin of ['http://127.0.0.1:18082', 'http://10.0.2.2:18081', 'http://localhost:9999', 'https://untrusted.example', 'null']) {
    assert.equal(allowed(origins, origin), false, origin);
  }
  assert.equal(allowed(origins, undefined), true); // Existing Realtime non-browser contract.
  assert.equal(origins.includes('*'), false);
});
