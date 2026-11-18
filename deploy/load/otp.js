// T2: driver sign-in by OTP at increasing arrival rates, straight to driver-api inside the cluster.
//   node deploy/load/k6-pod.cjs otp.js -e STAGES=5,10,20,30,40 -e STAGE=30s
// The OTP mock allows 10 requests per minute per client IP and one request per phone per cooldown, so every
// iteration is a different load driver presenting its own address through the trusted-proxy headers, as the
// Gateway would (PROXY_TOKEN = GATEWAY_PROXY_TOKEN of driver-api). Signing in rotates the driver's refresh token;
// run.cjs creates fresh driver sessions before each run, so later runs are not affected.
import http from 'k6/http';
import {SharedArray} from 'k6/data';
import {Counter} from 'k6/metrics';
import exec from 'k6/execution';

const BASE = (__ENV.DRIVER_URL || 'http://driver-api:3003').replace(/\/$/, '');
const STAGES = (__ENV.STAGES || '5,10,20,30,40').split(',').map(Number), STAGE = __ENV.STAGE || '30s';
const phones = new SharedArray('drivers', () => JSON.parse(open('../.local/load/drivers.json')).map(d => [d.index, d.phoneNumber]));

export const options = {
  scenarios: {otp: {executor: 'ramping-arrival-rate', startRate: STAGES[0], timeUnit: '1s', preAllocatedVUs: 50, maxVUs: 400,
    stages: STAGES.flatMap(rate => [{target: rate, duration: '5s'}, {target: rate, duration: STAGE}])}},
  thresholds: {'http_req_duration{name:otp_request}': ['p(95)<60000'], 'http_req_duration{name:otp_verify}': ['p(95)<60000']},
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};
const failed = new Counter('otp_failed'), limited = new Counter('otp_rate_limited');

export default function () {
  const i = exec.scenario.iterationInTest;
  if (i >= phones.length) return;
  const [index, phoneNumber] = phones[i];
  const headers = {'Content-Type': 'application/json', 'X-Driver-Proxy-Token': __ENV.PROXY_TOKEN, 'X-Driver-Client-IP': `198.19.${index >> 8}.${index & 255}`};
  const request = http.post(BASE + '/driver-auth/otp/request', JSON.stringify({phoneNumber}), {headers, tags: {name: 'otp_request'}});
  if (request.status !== 200) { (request.status === 429 ? limited : failed).add(1, {step: 'request', status: String(request.status)}); return; }
  const challengeId = request.json('data.challengeId');
  const verify = http.post(BASE + '/driver-auth/otp/verify', JSON.stringify({phoneNumber, challengeId, otp: '123456'}), {headers, tags: {name: 'otp_verify'}});
  if (verify.status !== 200) (verify.status === 429 ? limited : failed).add(1, {step: 'verify', status: String(verify.status)});
}

export function handleSummary(summary) {
  const m = summary.metrics, v = name => m[name] ? m[name].values : null;
  const lines = ['', 'OTP SUMMARY', `iterations=${m.iterations ? m.iterations.values.count : 0} failed=${m.otp_failed ? m.otp_failed.values.count : 0} rateLimited=${m.otp_rate_limited ? m.otp_rate_limited.values.count : 0} dropped=${m.dropped_iterations ? m.dropped_iterations.values.count : 0}`];
  for (const name of ['http_req_duration{name:otp_request}', 'http_req_duration{name:otp_verify}']) {
    const s = v(name);
    if (s) lines.push(`${name.padEnd(38)} p50=${s.med.toFixed(0)}ms p95=${s['p(95)'].toFixed(0)}ms p99=${s['p(99)'].toFixed(0)}ms max=${s.max.toFixed(0)}ms`);
  }
  const out = {stdout: lines.join('\n') + '\n'};
  if (__ENV.SUMMARY_OUT) out[__ENV.SUMMARY_OUT] = JSON.stringify(summary, null, 2);
  return out;
}
