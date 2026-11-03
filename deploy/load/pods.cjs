// Samples CPU, memory and network of every running pod from its cgroup and /proc/net/dev (no metrics-server needed),
// plus PostgreSQL connections and transaction counters.
//   node deploy/load/pods.cjs --interval 10 --out <file>     (stop with SIGINT/SIGTERM)
// CPU is the cgroup usage delta between samples, in millicores. Each sample is one `kubectl exec` per pod.
const fs = require('node:fs'), {execFile} = require('node:child_process');
const {kubectl, args} = require('./lib.cjs');

const options = args({interval: 10, out: ''});
const pods = JSON.parse(kubectl(['get', 'pods', '-o', 'json'])).items
  .filter(p => p.status.phase === 'Running').map(p => ({pod: p.metadata.name, app: p.metadata.labels?.['app.kubernetes.io/name'] ?? p.metadata.name.replace(/-[a-z0-9]+-[a-z0-9]+$/, '')}));
const series = Object.fromEntries(pods.map(p => [p.app, {cpuMillicores: [], memoryMiB: [], rxKBps: [], txKBps: [], last: null}]));
const db = {maxConnections: {}, last: null, totals: null, samples: 0};
const exec = (cmd, input) => new Promise(resolve => {
  const child = execFile('kubectl', ['--context', 'docker-desktop', '-n', 'chande-local', 'exec', ...(input ? ['-i'] : []), ...cmd], {timeout: 8000}, (error, stdout) => resolve(error ? null : stdout));
  if (input) child.stdin.end(input);
});

async function read(pod) {
  const out = await exec([pod, '--', 'cat', '/sys/fs/cgroup/cpu.stat', '/sys/fs/cgroup/memory.current', '/proc/net/dev']);
  if (!out) return null;
  const usec = Number(out.match(/usage_usec (\d+)/)?.[1]), memory = Number(out.match(/^(\d+)$/m)?.[1]);
  // Sum every interface except loopback: receive bytes is field 1, transmit bytes is field 9.
  let rx = 0, tx = 0;
  for (const line of out.split('\n')) { const m = line.match(/^\s*([^:\s]+):\s*(.*)$/); if (!m || m[1] === 'lo' || !/^\d/.test(m[2])) continue; const f = m[2].trim().split(/\s+/).map(Number); rx += f[0]; tx += f[8]; }
  return Number.isFinite(usec) ? {at: Date.now(), usec, memory, rx, tx} : null;
}

// Connections per database and state, and cumulative counters from pg_stat_database.
const DB_SQL = `SELECT 'c|' || coalesce(datname,'-') || '|' || coalesce(state,'-') || '|' || count(*) FROM pg_stat_activity WHERE backend_type='client backend' GROUP BY datname, state
UNION ALL SELECT 't|' || sum(xact_commit) || '|' || sum(xact_rollback) || '|' || sum(blks_hit) || '|' || sum(blks_read) || '|' || sum(deadlocks) || '|' || sum(temp_files) FROM pg_stat_database;`;
async function readDb() {
  const out = await exec(['deploy/postgres', '--', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d postgres -tA'], DB_SQL);
  if (!out) return;
  const at = Date.now();
  for (const line of out.trim().split('\n')) {
    const f = line.split('|');
    if (f[0] === 'c') { const key = `${f[1]}:${f[2]}`; db.maxConnections[key] = Math.max(db.maxConnections[key] ?? 0, Number(f[3])); }
    if (f[0] === 't') db.last = {at, commit: +f[1], rollback: +f[2], hit: +f[3], read: +f[4], deadlocks: +f[5], tempFiles: +f[6]};
  }
  db.totals ??= db.last; db.samples++;
}

async function sample() {
  await Promise.all([readDb(), ...pods.map(async p => {
    const s = await read(p.pod), entry = series[p.app];
    if (!s) return;
    if (entry.last) {
      const seconds = (s.at - entry.last.at) / 1000;
      entry.cpuMillicores.push((s.usec - entry.last.usec) / 1000 / seconds);
      entry.rxKBps.push((s.rx - entry.last.rx) / 1024 / seconds); entry.txKBps.push((s.tx - entry.last.tx) / 1024 / seconds);
    }
    entry.memoryMiB.push(s.memory / 1048576); entry.last = s;
  })]);
}

function summary() {
  const avg = v => v.length ? v.reduce((a, b) => a + b, 0) / v.length : null, round = v => v === null ? null : Math.round(v), max = v => v.length ? Math.max(...v) : null;
  const result = Object.fromEntries(Object.entries(series).map(([app, s]) => [app, {
    cpuAvgMillicores: round(avg(s.cpuMillicores)), cpuMaxMillicores: round(max(s.cpuMillicores)),
    memoryFirstMiB: round(s.memoryMiB[0] ?? null), memoryLastMiB: round(s.memoryMiB.at(-1) ?? null), memoryMaxMiB: round(max(s.memoryMiB)),
    rxAvgKBps: round(avg(s.rxKBps)), txAvgKBps: round(avg(s.txKBps)), samples: s.cpuMillicores.length}]));
  const d = db.last && db.totals ? {seconds: (db.last.at - db.totals.at) / 1000, commit: db.last.commit - db.totals.commit, rollback: db.last.rollback - db.totals.rollback,
    hit: db.last.hit - db.totals.hit, read: db.last.read - db.totals.read, deadlocks: db.last.deadlocks - db.totals.deadlocks, tempFiles: db.last.tempFiles - db.totals.tempFiles} : null;
  const database = d && {commitsPerSecond: Math.round(d.commit / Math.max(1, d.seconds)), rollbacks: d.rollback, deadlocks: d.deadlocks, tempFiles: d.tempFiles,
    cacheHitPercent: d.hit + d.read ? Math.round(d.hit / (d.hit + d.read) * 1000) / 10 : null, maxConnections: db.maxConnections, samples: db.samples};
  return {pods: result, database};
}

let timer;
async function stop() {
  clearInterval(timer);
  const result = summary();
  if (options.out) fs.writeFileSync(options.out, JSON.stringify(result, null, 2));
  console.info('PODS');
  console.table(Object.fromEntries(Object.entries(result.pods).map(([k, v]) => [k, {cpuAvg: v.cpuAvgMillicores, cpuMax: v.cpuMaxMillicores, memFirst: v.memoryFirstMiB, memLast: v.memoryLastMiB, memMax: v.memoryMaxMiB, rxKBps: v.rxAvgKBps, txKBps: v.txAvgKBps}])));
  console.info('DATABASE ' + JSON.stringify(result.database));
  process.exit(0);
}
process.on('SIGINT', stop); process.on('SIGTERM', stop);
(async () => { await sample(); timer = setInterval(() => { void sample(); }, options.interval * 1000); console.info(`sampling ${pods.length} pods every ${options.interval}s`); })();
