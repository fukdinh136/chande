const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), net = require('node:net');
const {spawn} = require('node:child_process');
const directory = path.join(__dirname, '.local', 'backend');
const baseUrl = 'http://127.0.0.1:18081';
const args = ['--context', 'docker-desktop', '-n', 'chande-local', 'port-forward', '--address', '127.0.0.1', 'service/edge', '18081:8088'];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function gatewayReady(base = baseUrl) {
  return new Promise(resolve => {
    const request = http.get(base + '/api/v1/trips/active', response => {
      let body = '';
      response.on('data', chunk => { body += chunk; if (body.length > 65536) request.destroy(); });
      response.on('end', () => {
        try {
          const value = JSON.parse(body);
          resolve(response.statusCode === 401 && value.error?.code === 'UNAUTHENTICATED' && typeof value.meta?.requestId === 'string');
        } catch { resolve(false); }
      });
      response.on('error', () => resolve(false));
    });
    request.setTimeout(1500, () => request.destroy());
    request.on('error', () => resolve(false));
  });
}
function portOpen(base) {
  const url = new URL(base);
  return new Promise(resolve => {
    const socket = net.connect(Number(url.port), url.hostname);
    const done = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(500, () => done(false));
    socket.once('connect', () => done(true)); socket.once('error', () => done(false));
  });
}
async function ensurePortForward({base = baseUrl, timeout = 45000} = {}) {
  // PID files are diagnostic only: the process may have exited or its PID may be reused.
  if (await gatewayReady(base)) return;
  if (await portOpen(base)) throw new Error('Port 18081 is open but does not expose the expected Gateway. No process was stopped.');
  if (base !== baseUrl) throw new Error('The managed forward is restricted to the local Kubernetes Gateway.');
  fs.mkdirSync(directory, {recursive: true});
  const output = fs.openSync(path.join(directory, 'port-forward.log'), 'a');
  const child = spawn(process.execPath, [__filename, '--supervise'], {detached: true, windowsHide: true, stdio: ['ignore', output, output]});
  fs.closeSync(output);
  fs.writeFileSync(path.join(directory, 'port-forward-supervisor.pid'), String(child.pid));
  child.unref();
  const end = Date.now() + timeout;
  do { if (await gatewayReady(base)) return; await pause(500); } while (Date.now() < end);
  throw new Error('Gateway forward is not ready; inspect deploy/.local/backend/port-forward.log. The helper will retry while Kubernetes recovers.');
}
async function supervise() {
  let child;
  const stop = () => { child?.kill(); process.exit(0); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  let retry = 1000;
  while (true) {
    // Reuse a valid forward opened by another invocation instead of competing for its port.
    if (await gatewayReady()) return;
    if (await portOpen(baseUrl)) throw new Error('Port 18081 is occupied by an unverified endpoint; refusing to replace it.');
    child = spawn('kubectl', args, {windowsHide: true, stdio: 'inherit'});
    if (child.pid) fs.writeFileSync(path.join(directory, 'port-forward.pid'), String(child.pid));
    const started = Date.now();
    await new Promise(resolve => { child.once('exit', resolve); child.once('error', error => { console.error(error.message); resolve(); }); });
    console.info(new Date().toISOString() + ' Gateway port-forward exited; reconnecting.');
    retry = Date.now() - started > 10000 ? 1000 : Math.min(10000, retry * 2);
    await pause(retry);
  }
}
if (require.main === module) supervise().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = {gatewayReady, ensurePortForward};
