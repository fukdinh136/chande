// C2: riders opening the app while others book. Each iteration is one app start: the active trip, then the history page.
//   k6 run -e READS=25 -e DURATION=5m deploy/load/reads.js     (traffic.cjs runs it next to booking.js with --reads 25)
// Readers use the second half of rider-tokens.json so they are not the riders booking in booking.js (VU index from 0).
import http from 'k6/http';
import {SharedArray} from 'k6/data';
import {Counter} from 'k6/metrics';
import exec from 'k6/execution';

const BASE = (__ENV.BACKEND_URL || 'http://127.0.0.1:18081').replace(/\/$/, '') + '/api/v1';
const READS = Number(__ENV.READS || 25), DURATION = __ENV.DURATION || '5m';
const tokens = new SharedArray('riders', () => JSON.parse(open('../.local/load/rider-tokens.json')));
const offset = Math.floor(tokens.length / 2), readers = tokens.length - offset;

export const options = {
  scenarios: {reads: {executor: 'constant-arrival-rate', rate: READS, timeUnit: '1s', duration: DURATION, preAllocatedVUs: 50, maxVUs: 500}},
  thresholds: {'http_req_duration{name:active}': ['p(95)<60000'], 'http_req_duration{name:history}': ['p(95)<60000']},
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};
const failed = new Counter('reads_failed');

export default function () {
  const token = tokens[offset + exec.scenario.iterationInTest % readers];
  const headers = {Authorization: 'Bearer ' + token, 'X-Request-Id': crypto.randomUUID()};
  for (const [name, path] of [['active', '/trips/active'], ['history', '/trips/history?limit=20']]) {
    const r = http.get(BASE + path, {headers, tags: {name}});
    if (r.status !== 200) failed.add(1, {step: name, status: String(r.status)});
  }
}

export function handleSummary(summary) {
  const m = summary.metrics, v = name => m[name] ? m[name].values : null;
  const lines = ['', 'READS SUMMARY', `iterations=${m.iterations ? m.iterations.values.count : 0} failed=${m.reads_failed ? m.reads_failed.values.count : 0} dropped=${m.dropped_iterations ? m.dropped_iterations.values.count : 0}`];
  for (const name of ['http_req_duration{name:active}', 'http_req_duration{name:history}']) {
    const s = v(name);
    if (s) lines.push(`${name.padEnd(34)} p50=${s.med.toFixed(0)}ms p95=${s['p(95)'].toFixed(0)}ms p99=${s['p(99)'].toFixed(0)}ms max=${s.max.toFixed(0)}ms`);
  }
  const out = {stdout: lines.join('\n') + '\n'};
  if (__ENV.SUMMARY_OUT) out[__ENV.SUMMARY_OUT] = JSON.stringify(summary, null, 2);
  return out;
}
