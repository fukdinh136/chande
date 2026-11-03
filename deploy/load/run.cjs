// One baseline run: fresh rider tokens -> drivers online -> warm-up -> k6 booking + pod sampling -> report.
//   node deploy/load/run.cjs --drivers 50 --rate 1 --duration 5m
//   node deploy/load/run.cjs --drivers 3500 --radius 6000 --ramp 25 --trips 3000 --rate 25 --drain 900   (burst: riders keep their trips)
// Results go to deploy/.local/load/results/<timestamp>/ (k6.json, drivers.json, pods.json, summary.json).
const fs = require('node:fs'), path = require('node:path'), {spawn, spawnSync} = require('node:child_process');
const {dir, base, pause, args} = require('./lib.cjs');

const options = args({drivers: 50, radius: 2000, ramp: 0, rate: 1, duration: '5m', warmup: 20, interval: 10, trips: 0, drain: 900, gpsMs: 3000, login: 0});
const script = (name, extra) => { const r = spawnSync(process.execPath, [path.join(__dirname, name), ...extra], {stdio: 'inherit'}); if (r.status !== 0) throw new Error(`${name} ${extra[0] ?? ''} failed`); };
const stamp = new Date().toISOString().replace(/[:.]/g, '-'), out = path.join(dir, 'results', stamp);
fs.mkdirSync(out, {recursive: true});
const node = (script, extra) => spawn(process.execPath, [path.join(__dirname, script), ...extra], {stdio: ['ignore', 'pipe', 'inherit']});
const readOptional = name => { try { return JSON.parse(fs.readFileSync(path.join(out, name), 'utf8')); } catch { return null; } };
const exited = child => new Promise(resolve => child.once('exit', code => resolve(code)));

(async () => {
  script('accounts.cjs', ['tokens']);
  // Fresh driver sessions: a killed earlier run may have rotated tokens without saving them.
  script('accounts.cjs', ['sessions', '--drivers', String(options.drivers)]);
  // Trips left by an earlier run are cancelled here (in parallel) instead of in k6 setup(), which is sequential.
  script('accounts.cjs', ['cleanup']);

  const drivers = node('drivers.cjs', ['--count', String(options.drivers), '--radius', String(options.radius), '--ramp', String(options.ramp), '--gps-ms', String(options.gpsMs), '--out', path.join(out, 'drivers.json')]);
  await new Promise((resolve, reject) => {
    drivers.stdout.on('data', chunk => { process.stdout.write(chunk); if (/READY \d+/.test(chunk)) resolve(); });
    drivers.once('exit', code => reject(new Error('Driver simulator exited early with code ' + code)));
  });
  console.info(`Warm-up ${options.warmup}s so every driver has fresh GPS in Redis`);
  await pause(options.warmup * 1000);

  const pods = node('pods.cjs', ['--interval', String(options.interval), '--out', path.join(out, 'pods.json')]);
  pods.stdout.pipe(process.stdout);
  const started = new Date().toISOString();
  const k6 = spawn('k6', ['run', '-q', '-e', 'BACKEND_URL=' + base, '-e', 'RATE=' + options.rate, '-e', 'DURATION=' + options.duration, '-e', 'TRIPS=' + options.trips, '-e', 'SKIP_SETUP=1', '-e', 'LOGIN=' + options.login, '-e', 'SUMMARY_OUT=' + path.join(out, 'k6.json'), path.join(__dirname, 'booking.js')], {stdio: 'inherit'});
  const k6Code = await exited(k6);
  const finished = new Date().toISOString();
  // Burst mode: wait until every trip is assigned (or --drain seconds), then free the drivers.
  if (options.trips) {
    script('assignments.cjs', ['--since', started, '--wait', String(options.drain), '--out', path.join(out, 'assignments.json')]);
    script('accounts.cjs', ['tokens']); script('accounts.cjs', ['cleanup']);
  }

  pods.kill('SIGTERM'); drivers.kill('SIGTERM');
  await Promise.all([exited(pods), exited(drivers)]);

  const k6Summary = JSON.parse(fs.readFileSync(path.join(out, 'k6.json'), 'utf8')).metrics;
  const pick = name => { const v = k6Summary[name]?.values; return v ? {p50: Math.round(v.med), p95: Math.round(v['p(95)']), p99: Math.round(v['p(99)']), max: Math.round(v.max)} : null; };
  const summary = {started, finished, base, options, k6ExitCode: k6Code,
    trips: {assigned: k6Summary.trips_assigned?.values.count ?? 0, notAssigned: k6Summary.trips_not_assigned?.values.count ?? 0, failed: k6Summary.trips_failed?.values.count ?? 0, droppedIterations: k6Summary.dropped_iterations?.values.count ?? 0},
    httpFailedRate: k6Summary.http_req_failed.values.rate, httpRequests: k6Summary.http_reqs.values.count,
    latencyMs: {timeToAssigned: pick('time_to_assigned'), quote: pick('http_req_duration{name:quote}'), create: pick('http_req_duration{name:create}'), poll: pick('http_req_duration{name:poll}'), cancel: pick('http_req_duration{name:cancel}')},
    created: k6Summary.trips_created?.values.count ?? null, assignments: readOptional('assignments.json'), drivers: readOptional('drivers.json'), pods: readOptional('pods.json')};
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  console.info('Results: ' + path.relative(process.cwd(), out));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
