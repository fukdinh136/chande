// Keeps N load riders online like the app: one Gateway /ws session each (auth, ping every 25 s), reconnecting after a
// close. Used for the concurrent-users test: riders stay connected while k6 books trips for some of them.
//   node deploy/load/riders.cjs --count 5000 --out /tmp/riders-online.json
// Prints "RIDERS_READY <connected>" once at least 99% are authenticated (or after 180 s), and writes a summary on SIGTERM.
const fs = require('node:fs');
const {base, pause, readJson, percentile, args} = require('./lib.cjs');

const o = args({count: 0, out: '', rate: 200});
if (!o.count || !o.out) throw new Error('--count and --out are required');
const tokens = readJson('rider-tokens.json', []).slice(0, o.count);
if (tokens.length < o.count) throw new Error(`Only ${tokens.length} rider tokens; seed more riders and run accounts.cjs tokens`);
const url = base.replace(/^http/, 'ws') + '/ws';
const stats = {connected: 0, peakConnected: 0, authFailures: 0, disconnects: 0, reconnects: 0, events: 0, errors: 0, closeCodes: {}};
const authMs = [], sockets = new Array(o.count);
let stopping = false, readyPrinted = false;

function open(index, retry = false) {
  if (stopping) return;
  if (retry) stats.reconnects++;
  const started = Date.now(); let authed = false;
  const ws = new WebSocket(url); sockets[index] = ws;
  ws.onopen = () => ws.send(JSON.stringify({type: 'auth', token: tokens[index]}));
  ws.onmessage = event => {
    let message; try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'auth.ok' && !authed) {
      authed = true; authMs.push(Date.now() - started);
      stats.connected++; stats.peakConnected = Math.max(stats.peakConnected, stats.connected);
      if (!readyPrinted && stats.connected >= Math.ceil(o.count * 0.99)) { readyPrinted = true; console.info('RIDERS_READY ' + stats.connected); }
    } else if (message.type === 'trip.event') stats.events++;
  };
  ws.onerror = () => { stats.errors++; };
  ws.onclose = event => {
    stats.closeCodes[event.code] = (stats.closeCodes[event.code] ?? 0) + 1;
    if (authed) { stats.connected--; stats.disconnects++; } else stats.authFailures++;
    if (!stopping) setTimeout(() => open(index, true), 1000 + Math.random() * 2000);
  };
}

// Like the app: a ping every 25 s keeps idle sessions open through the edge proxy.
setInterval(() => { for (const ws of sockets) if (ws?.readyState === WebSocket.OPEN) ws.send('{"type":"ping"}'); }, 25000).unref();

process.once('SIGTERM', () => {
  stopping = true;
  const summary = {riders: o.count, connectedAtEnd: stats.connected, ...stats, authMs: {count: authMs.length, p50: percentile(authMs, 50), p95: percentile(authMs, 95), max: Math.max(0, ...authMs)}};
  for (const ws of sockets) try { ws?.close(); } catch { /* already closed */ }
  fs.writeFileSync(o.out, JSON.stringify(summary, null, 2)); console.info('RIDERS ' + JSON.stringify(summary)); process.exit(0);
});

(async () => {
  // Open about o.rate sessions per second so the Gateway sees a wave of app starts, not one burst.
  const perTick = Math.max(1, Math.round(o.rate / 10));
  for (let i = 0; i < o.count; i++) { open(i); if ((i + 1) % perTick === 0) await pause(100); }
  await pause(180000);
  if (!readyPrinted) { readyPrinted = true; console.info('RIDERS_READY ' + stats.connected); }
})();
