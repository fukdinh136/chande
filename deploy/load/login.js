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
  thresholds: {'http_req_duration{name:login}': ['p(95)<1000'], login_rate_limited: ['count>=0']},
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};
const limited = new Counter('login_rate_limited'), failed = new Counter('login_failed');

export default function () {
  const [phoneNumber, password] = riders[exec.scenario.iterationInTest % riders.length];
  const r = http.post(BASE + '/auth/login', JSON.stringify({phoneNumber, password}), {headers: {'Content-Type': 'application/json', 'X-Request-Id': crypto.randomUUID()}, tags: {name: 'login'}});
  if (r.status === 429) limited.add(1); else if (r.status !== 200) failed.add(1, {status: String(r.status)});
}
