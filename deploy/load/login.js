// k6 rider login load: POST /auth/login at increasing arrival rates (BCrypt runs in User Service).
//   k6 run -e STAGES=5,10,15,20 -e STAGE=1m deploy/load/login.js
// The Gateway limits /auth/login per source IP (local AUTH_MAX_ATTEMPTS=1000/min); every k6 request shares one IP.
import http from 'k6/http';
import {SharedArray} from 'k6/data';
import {Counter} from 'k6/metrics';
import exec from 'k6/execution';

const BASE = (__ENV.BACKEND_URL || 'http://127.0.0.1:18081').replace(/\/$/, '') + '/api/v1';
const STAGES = (__ENV.STAGES || '5,10,15,20').split(',').map(Number), STAGE = __ENV.STAGE || '1m';
const riders = new SharedArray('riders', () => JSON.parse(open('../.local/load/riders.json')).map(r => [r.phoneNumber, r.password]));

export const options = {
  scenarios: {login: {executor: 'ramping-arrival-rate', startRate: STAGES[0], timeUnit: '1s', preAllocatedVUs: 50, maxVUs: 400,
    stages: STAGES.flatMap(rate => [{target: rate, duration: '5s'}, {target: rate, duration: STAGE}])}},
  // The second duration covers successful logins only, to compare with the latency of every login while the user
  // service sheds load with 503 SERVICE_BUSY (BCRYPT_MAX_WAIT).
  thresholds: {'http_req_duration{name:login}': ['p(95)<1000'], 'http_req_duration{name:login,expected_response:true}': ['p(95)<1000'], login_rate_limited: ['count>=0'], login_busy: ['count>=0']},
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};
const limited = new Counter('login_rate_limited'), busy = new Counter('login_busy'), failed = new Counter('login_failed');

export default function () {
  const [phoneNumber, password] = riders[exec.scenario.iterationInTest % riders.length];
  const r = http.post(BASE + '/auth/login', JSON.stringify({phoneNumber, password}), {headers: {'Content-Type': 'application/json', 'X-Request-Id': crypto.randomUUID()}, tags: {name: 'login'}});
  if (r.status === 429) limited.add(1); else if (r.status === 503) busy.add(1); else if (r.status !== 200) failed.add(1, {status: String(r.status)});
}

export function handleSummary(summary) {
  const m = summary.metrics, count = name => m[name] ? m[name].values.count : 0;
  const lines = ['', 'LOGIN SUMMARY', `requests=${count('iterations')} busy503=${count('login_busy')} failed=${count('login_failed')} rateLimited=${count('login_rate_limited')} dropped=${count('dropped_iterations')}`];
  for (const name of ['http_req_duration{name:login}', 'http_req_duration{name:login,expected_response:true}']) {
    const s = m[name] && m[name].values;
    if (s) lines.push(`${name.padEnd(52)} p50=${s.med.toFixed(0)}ms p95=${s['p(95)'].toFixed(0)}ms p99=${s['p(99)'].toFixed(0)}ms max=${s.max.toFixed(0)}ms`);
  }
  const out = {stdout: lines.join('\n') + '\n'};
  if (__ENV.SUMMARY_OUT) out[__ENV.SUMMARY_OUT] = JSON.stringify(summary, null, 2);
  return out;
}
