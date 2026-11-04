// One load run: fresh tokens and driver sessions -> traffic (drivers online, warm-up, k6) -> pod, SQL and stage reports.
//   node deploy/load/run.cjs --drivers 1000 --radius 6000 --rate 4 --duration 2m --in-cluster 1 --events ws
//   node deploy/load/run.cjs --drivers 1000 --radius 6000 --rate 4 --duration 2m --gps-ms 3000 --events poll   (2026-10-29 baseline method)
//   node deploy/load/run.cjs --drivers 3500 --radius 6000 --ramp 25 --trips 3000 --rate 25 --drain 900   (burst: riders keep their trips)
// --in-cluster 1 runs traffic.cjs in a pod (image chande-load:local) that calls the edge Service directly (E1).
// Results go to deploy/.local/load/results/<timestamp>/: k6.json, drivers.json, pods.json, sql.json, segments.json, summary.json.
const fs = require('node:fs'), path = require('node:path'), {spawn, spawnSync} = require('node:child_process');
const {dir, base, args, kubectl} = require('./lib.cjs');

const options = args({drivers: 50, radius: 2000, ramp: 0, rate: 1, duration: '5m', warmup: 20, interval: 10, trips: 0, drain: 900, gpsMs: 10000, login: 0, events: 'poll', inCluster: 0});
const script = (name, extra) => { const r = spawnSync(process.execPath, [path.join(__dirname, name), ...extra], {stdio: 'inherit'}); if (r.status !== 0) throw new Error(`${name} ${extra[0] ?? ''} failed`); };
const stamp = new Date().toISOString().replace(/[:.]/g, '-'), out = path.join(dir, 'results', stamp);
fs.mkdirSync(out, {recursive: true});
const node = (name, extra) => spawn(process.execPath, [path.join(__dirname, name), ...extra], {stdio: ['ignore', 'pipe', 'inherit']});
const readOptional = name => { try { return JSON.parse(fs.readFileSync(path.join(out, name), 'utf8')); } catch { return null; } };
const exited = child => new Promise(resolve => child.once('exit', code => resolve(code)));
const RUNNER = 'load-runner', REMOTE = '/work/out';

// A fresh runner pod per run, so no state leaks between runs; inputs are copied in, results copied out.
function startRunner() {
  kubectl(['delete', 'pod', RUNNER, '--ignore-not-found', '--wait=true']);
  const pod = {apiVersion: 'v1', kind: 'Pod', metadata: {name: RUNNER, labels: {'app.kubernetes.io/name': RUNNER, 'app.kubernetes.io/part-of': 'chande'}},
    spec: {restartPolicy: 'Never', automountServiceAccountToken: false, terminationGracePeriodSeconds: 30,
      containers: [{name: RUNNER, image: 'chande-load:local', imagePullPolicy: 'Never', resources: {requests: {cpu: '100m', memory: '256Mi'}, limits: {cpu: '2', memory: '2Gi'}}}]}};
  kubectl(['apply', '-f', '-'], JSON.stringify(pod));
  kubectl(['wait', '--for=condition=Ready', 'pod/' + RUNNER, '--timeout=120s']);
  for (const name of ['drivers.json', 'rider-tokens.json', ...(options.login ? ['riders.json'] : [])]) kubectl(['cp', path.join(dir, name), `${RUNNER}:/load/deploy/.local/load/${name}`]);
}

(async () => {
  script('accounts.cjs', ['tokens']);
  // Fresh driver sessions: a killed earlier run may have rotated tokens without saving them.
  script('accounts.cjs', ['sessions', '--drivers', String(options.drivers)]);
  // Trips left by an earlier run are cancelled here (in parallel) instead of in k6 setup(), which is sequential.
  script('accounts.cjs', ['cleanup']);

  const traffic = ['--drivers', options.drivers, '--radius', options.radius, '--ramp', options.ramp, '--gps-ms', options.gpsMs, '--rate', options.rate, '--duration', options.duration,
    '--warmup', options.warmup, '--trips', options.trips, '--login', options.login, '--events', options.events, '--hold', options.trips ? 1 : 0].map(String);
  if (options.inCluster) startRunner();
  const child = options.inCluster
    ? spawn('kubectl', ['--context', 'docker-desktop', '-n', 'chande-local', 'exec', RUNNER, '--', 'node', 'deploy/load/traffic.cjs', ...traffic, '--out', REMOTE], {stdio: ['ignore', 'pipe', 'inherit']})
    : node('traffic.cjs', [...traffic, '--out', out]);
  let started, finished, k6ExitCode, pods;
  // traffic.cjs marks the k6 window; pod sampling and SQL statistics cover exactly that window.
  await new Promise(resolve => {
    let buffer = '';
    child.stdout.on('data', chunk => {
      process.stdout.write(chunk); buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
        if (line.startsWith('K6_START ')) {
          started = line.split(' ')[1];
          script('sql-stats.cjs', ['reset']);
          pods = node('pods.cjs', ['--interval', String(options.interval), '--out', path.join(out, 'pods.json')]); pods.stdout.pipe(process.stdout);
        }
        if (line.startsWith('K6_END ')) { [, finished, k6ExitCode] = line.split(' '); script('sql-stats.cjs', ['top', '--out', path.join(out, 'sql.json')]); resolve(); }
      }
    });
    child.once('exit', () => resolve());
  });
  // Burst mode: wait until every trip is assigned (or --drain seconds), then free the drivers.
  if (options.trips && started) {
    script('assignments.cjs', ['--since', started, '--wait', String(options.drain), '--out', path.join(out, 'assignments.json')]);
    script('accounts.cjs', ['tokens']); script('accounts.cjs', ['cleanup']);
    if (options.inCluster) kubectl(['exec', RUNNER, '--', 'touch', REMOTE + '/release']); else fs.writeFileSync(path.join(out, 'release'), '');
  }
  const code = await exited(child);
  if (pods) { pods.kill('SIGTERM'); await exited(pods); }
  if (code !== 0 || !started) throw new Error('Traffic run failed with code ' + code);
  if (options.inCluster) { for (const name of ['k6.json', 'drivers.json']) kubectl(['cp', `${RUNNER}:${REMOTE}/${name}`, path.join(out, name)]); kubectl(['delete', 'pod', RUNNER, '--wait=false']); }
  script('segments.cjs', ['--since', started, '--until', finished, '--out', path.join(out, 'segments.json')]);

  const k6Summary = JSON.parse(fs.readFileSync(path.join(out, 'k6.json'), 'utf8')).metrics;
  const pick = name => { const v = k6Summary[name]?.values; return v ? {p50: Math.round(v.med), p95: Math.round(v['p(95)']), p99: Math.round(v['p(99)']), max: Math.round(v.max)} : null; };
  const summary = {started, finished, base: options.inCluster ? 'http://edge:8088 (in-cluster)' : base, options, k6ExitCode: Number(k6ExitCode),
    trips: {assigned: k6Summary.trips_assigned?.values.count ?? 0, notAssigned: k6Summary.trips_not_assigned?.values.count ?? 0, failed: k6Summary.trips_failed?.values.count ?? 0, droppedIterations: k6Summary.dropped_iterations?.values.count ?? 0},
    httpFailedRate: k6Summary.http_req_failed.values.rate, httpRequests: k6Summary.http_reqs.values.count, wsFailed: k6Summary.ws_failed?.values.count ?? 0,
    latencyMs: {timeToAssigned: pick('time_to_assigned'), quote: pick('http_req_duration{name:quote}'), create: pick('http_req_duration{name:create}'), poll: pick('http_req_duration{name:poll}'), read: pick('http_req_duration{name:read}'), cancel: pick('http_req_duration{name:cancel}')},
    created: k6Summary.trips_created?.values.count ?? null, assignments: readOptional('assignments.json'), segments: readOptional('segments.json'), sql: readOptional('sql.json'), drivers: readOptional('drivers.json'), pods: readOptional('pods.json')};
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  console.info('Results: ' + path.relative(process.cwd(), out));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
