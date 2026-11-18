// T4-T9: the Gateway's per-(endpoint, client IP) limit on sign-in endpoints, with the default 5 per minute.
//   kubectl --context docker-desktop -n chande-local set env deployment/gateway-api AUTH_MAX_ATTEMPTS=5
//   node deploy/load/ratelimit.cjs --out <file>        (host, through the port-forward: one client IP)
//   kubectl ... set env deployment/gateway-api AUTH_MAX_ATTEMPTS-   (back to the load setting afterwards)
// The second client IP (T6) is a pod inside the cluster: the script runs `node -e` in the edge-facing load image.
// Bodies are invalid or use a phone number with no account, so nothing is created; every attempt still counts.
const fs = require('node:fs'), {spawnSync} = require('node:child_process');
const {base, kubectl, args, pause} = require('./lib.cjs');

const options = args({out: '', limit: 5});
const API = base + '/api/v1';
const bodies = {
  '/auth/login': {phoneNumber: '0399999999', password: 'not-the-password-1'},
  '/auth/register': {},
  '/driver-auth/otp/request': {phoneNumber: '0399999998'},
  '/driver-auth/otp/verify': {phoneNumber: '0399999998', challengeId: '00000000-0000-4000-8000-000000000000', otp: '000000'},
};
async function call(path, headers = {}) {
  const r = await fetch(API + path, {method: 'POST', headers: {'Content-Type': 'application/json', ...headers}, body: JSON.stringify(bodies[path])});
  await r.body?.cancel();
  return {status: r.status, retryAfter: r.headers.get('retry-after')};
}
// n calls in a row; passes when the first `limit` are not 429 and the rest are 429 with Retry-After.
async function burst(path, n, headers) {
  const results = [];
  for (let i = 0; i < n; i++) results.push(await call(path, headers));
  const ok = results.slice(0, options.limit).every(r => r.status !== 429) && results.slice(options.limit).every(r => r.status === 429 && Number(r.retryAfter) > 0);
  return {ok, statuses: results.map(r => r.status), retryAfter: results.at(-1).retryAfter};
}
// One login from a pod: a different client IP as seen by the edge.
function loginFromPod() {
  const code = `fetch('http://edge:8088/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(bodies['/auth/login'])})}).then(r=>console.log(r.status))`;
  const pod = 'ratelimit-ip2';
  kubectl(['delete', 'pod', pod, '--ignore-not-found', '--wait=true']);
  const r = spawnSync('kubectl', ['--context', 'docker-desktop', '-n', 'chande-local', 'run', pod, '--image=chande-load:local', '--image-pull-policy=Never', '--restart=Never', '--rm', '-i', '--quiet', '--command', '--', 'node', '-e', code], {encoding: 'utf8'});
  return Number(r.stdout.trim().split('\n').pop());
}

(async () => {
  const report = {};
  report.T4 = await burst('/auth/login', options.limit + 1);
  // T7: a forged X-Forwarded-For per request must not buy a new quota; the edge overwrites it with the real address.
  const forged = [];
  for (let i = 0; i < 3; i++) forged.push((await call('/auth/login', {'X-Forwarded-For': `203.0.113.${10 + i}`, 'X-Real-IP': `203.0.113.${10 + i}`})).status);
  report.T7 = {ok: forged.every(s => s === 429), statuses: forged};
  // T6: another client IP has its own quota while the first one is blocked.
  const second = loginFromPod();
  report.T6 = {ok: second !== 429 && second > 0, status: second};
  // T8: login is exhausted, the other endpoints still have their own budget.
  const others = {};
  for (const path of ['/auth/register', '/driver-auth/otp/request', '/driver-auth/otp/verify']) others[path] = (await call(path)).status;
  report.T8 = {ok: Object.values(others).every(s => s !== 429), statuses: others};
  // T9: each of them blocks the call after the limit (T8 already used one attempt of each).
  report.T9 = {};
  for (const path of ['/auth/register', '/driver-auth/otp/request', '/driver-auth/otp/verify']) {
    const rest = await burst(path, options.limit);
    const statuses = [others[path], ...rest.statuses];
    report.T9[path] = {ok: statuses.slice(0, options.limit).every(s => s !== 429) && statuses[options.limit] === 429, statuses};
  }
  // T5: after Retry-After the sliding window lets the next attempt through (it does not block a whole fixed minute).
  const wait = Number(report.T4.retryAfter);
  await pause((wait + 1) * 1000);
  const after = await call('/auth/login');
  report.T5 = {ok: after.status !== 429, waitedSeconds: wait + 1, status: after.status};
  report.ok = report.T4.ok && report.T5.ok && report.T6.ok && report.T7.ok && report.T8.ok && Object.values(report.T9).every(r => r.ok);
  if (options.out) fs.writeFileSync(options.out, JSON.stringify(report, null, 2));
  console.info(JSON.stringify(report, null, 2));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
