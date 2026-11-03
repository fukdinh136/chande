// Shared helpers for the local load test. Targets loopback only: it uses local fixture accounts.
const fs = require('node:fs'), path = require('node:path'), {randomUUID} = require('node:crypto'), {spawnSync} = require('node:child_process');

const base = (process.env.BACKEND_URL || 'http://127.0.0.1:18081').replace(/\/$/, '');
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Load test uses local fixture accounts; only loopback targets are allowed');
const dir = path.join(__dirname, '..', '.local', 'load');
fs.mkdirSync(dir, {recursive: true});

// Hoan Kiem, Hanoi. Drivers and pickups are synthetic points around it.
const center = {lat: 21.0285, lng: 105.8542};
const pause = ms => new Promise(r => setTimeout(r, ms));

class HttpError extends Error {
  constructor(path, status, code, retryAfter) { super(`${path}: HTTP ${status} ${code ?? ''}`.trim()); this.status = status; this.code = code; this.retryAfter = retryAfter; }
}

// The port-forward/nginx hop sometimes closes a pooled keep-alive socket; retry those once or twice.
const TRANSIENT = new Set(['UND_ERR_SOCKET', 'ECONNRESET', 'EPIPE']);
async function send(url, init, attempt = 1) {
  try { return await fetch(url, init); } catch (e) {
    if (attempt >= 3 || !TRANSIENT.has(e.cause?.code)) throw e;
    await pause(100 * attempt); return send(url, init, attempt + 1);
  }
}

async function request(route, {body, token, method, headers = {}, expected = [200]} = {}) {
  const response = await send(base + '/api/v1' + route, {
    method: method ?? (body === undefined ? 'GET' : 'POST'), signal: AbortSignal.timeout(15000),
    headers: {'Content-Type': 'application/json', 'X-Request-Id': randomUUID(), ...(token ? {Authorization: 'Bearer ' + token} : {}), ...headers},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
  const text = await response.text(), raw = text ? JSON.parse(text) : null;
  if (!expected.includes(response.status)) throw new HttpError(route, response.status, raw?.error?.code ?? raw?.code, Number(response.headers.get('retry-after')) || undefined);
  return raw && typeof raw === 'object' && Object.hasOwn(raw, 'data') ? raw.data : raw;
}

// Retries 429 using Retry-After; the gateway and the OTP mock both limit auth calls per source IP.
async function withRateLimit(work, label) {
  for (;;) {
    try { return await work(); } catch (e) {
      if (e.status !== 429) throw e;
      const wait = (e.retryAfter ?? 15) * 1000;
      console.info(`${label}: rate limited, waiting ${wait / 1000}s`);
      await pause(wait);
    }
  }
}

const file = name => path.join(dir, name);
const readJson = (name, fallback) => fs.existsSync(file(name)) ? JSON.parse(fs.readFileSync(file(name), 'utf8')) : fallback;
const writeJson = (name, value) => { const tmp = file(name) + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(value, null, 2)); fs.renameSync(tmp, file(name)); };

function kubectl(args, input) {
  const r = spawnSync('kubectl', ['--context', 'docker-desktop', '--namespace', 'chande-local', ...args], {encoding: 'utf8', input, maxBuffer: 32 * 1024 * 1024});
  if (r.status !== 0) throw new Error(`kubectl ${args.slice(0, 3).join(' ')} failed: ${(r.stderr || '').trim()}`);
  return r.stdout;
}

// Random point at most `meters` away from `origin`.
function around(origin, meters, min = 0) {
  const distance = min + Math.sqrt(Math.random()) * (meters - min), angle = Math.random() * 2 * Math.PI;
  return {lat: origin.lat + distance * Math.cos(angle) / 111320, lng: origin.lng + distance * Math.sin(angle) / (111320 * Math.cos(origin.lat * Math.PI / 180))};
}

async function pool(items, size, work) {
  const queue = [...items.entries()], results = [];
  await Promise.all(Array.from({length: Math.min(size, items.length)}, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) results[next[0]] = await work(next[1], next[0]);
  }));
  return results;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p / 100 * sorted.length) - 1)];
}

function args(defaults) {
  const out = {...defaults};
  for (let i = 2; i < process.argv.length; i++) {
    const m = process.argv[i].match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!m) continue;
    const key = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase()), value = m[2] ?? process.argv[++i];
    out[key] = typeof defaults[key] === 'number' ? Number(value) : value;
  }
  return out;
}

module.exports = {base, dir, center, pause, request, withRateLimit, readJson, writeJson, file, kubectl, around, pool, percentile, args, randomUUID};
