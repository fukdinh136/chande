// The traffic part of one load run: drivers online -> warm-up -> k6 -> drivers offline.
// run.cjs starts it on the host, or inside the cluster with --in-cluster (E1). It prints "K6_START <iso>" and
// "K6_END <iso>" so run.cjs can sample pods and SQL around the k6 window. With --hold 1 (burst mode) drivers stay
// online after k6 until the file <out>/release exists, so queued trips can still be assigned.
const fs = require('node:fs'), path = require('node:path'), {spawn} = require('node:child_process');
const {base, pause, args} = require('./lib.cjs');

const o = args({drivers: 50, radius: 2000, ramp: 0, gpsMs: 10000, rate: 1, duration: '5m', warmup: 20, trips: 0, login: 0, events: 'poll', hold: 0, out: ''});
if (!o.out) throw new Error('--out is required');
fs.mkdirSync(o.out, {recursive: true});
const exited = child => new Promise(resolve => child.once('exit', code => resolve(code)));

(async () => {
  const drivers = spawn(process.execPath, [path.join(__dirname, 'drivers.cjs'), '--count', String(o.drivers), '--radius', String(o.radius), '--ramp', String(o.ramp), '--gps-ms', String(o.gpsMs), '--out', path.join(o.out, 'drivers.json')], {stdio: ['ignore', 'pipe', 'inherit']});
  await new Promise((resolve, reject) => {
    drivers.stdout.on('data', chunk => { process.stdout.write(chunk); if (/READY \d+/.test(chunk)) resolve(); });
    drivers.once('exit', code => reject(new Error('Driver simulator exited early with code ' + code)));
  });
  console.info(`Warm-up ${o.warmup}s so every driver has fresh GPS in Redis`);
  await pause(o.warmup * 1000);
  console.info('K6_START ' + new Date().toISOString());
  const k6 = spawn('k6', ['run', '-q', '-e', 'BACKEND_URL=' + base, '-e', 'RATE=' + o.rate, '-e', 'DURATION=' + o.duration, '-e', 'TRIPS=' + o.trips, '-e', 'SKIP_SETUP=1', '-e', 'LOGIN=' + o.login, '-e', 'EVENTS=' + o.events, '-e', 'SUMMARY_OUT=' + path.join(o.out, 'k6.json'), path.join(__dirname, 'booking.js')], {stdio: 'inherit'});
  const code = await exited(k6);
  console.info('K6_END ' + new Date().toISOString() + ' ' + code);
  if (o.hold) while (!fs.existsSync(path.join(o.out, 'release'))) await pause(1000);
  drivers.kill('SIGTERM'); await exited(drivers);
})().catch(e => { console.error(e.message); process.exitCode = 1; });
