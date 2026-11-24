import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

const telemetry = join(__dirname, '..', 'src', 'bootstrap', 'telemetry.js');
// Runs a small program in a fresh process, the way an entry point loads the bootstrap first.
function run(program: string, env: Record<string, string>): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('OTEL_')));
    const child = spawn(process.execPath, ['-e', program], { env: { ...clean, ...env, TELEMETRY: telemetry } });
    let out = ''; child.stdout.on('data', chunk => { out += String(chunk); }); child.stderr.on('data', chunk => { out += String(chunk); });
    child.on('error', reject); child.on('close', code => { resolve({ code, out }); });
  });
}

test('telemetry stays out of the process when no collector endpoint is set', async () => {
  const result = await run(`require(process.env.TELEMETRY); require('node:http');
    console.log(JSON.stringify(Object.keys(require.cache).filter(file => file.includes('@opentelemetry')).length));`, {});
  assert.equal(result.code, 0, result.out); assert.equal(result.out.trim(), '0');
});

test('telemetry sends traces and metrics to the collector, and skips health probes', async () => {
  const received: string[] = [];
  const collector = createServer((req, res) => { received.push(req.url ?? ''); req.resume(); req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/x-protobuf' }); res.end(); }); });
  await new Promise<void>(resolve => collector.listen(0, '127.0.0.1', () => { resolve(); }));
  const endpoint = `http://127.0.0.1:${(collector.address() as AddressInfo).port}`;
  try {
    // The program serves one request to itself over fetch, records one custom metric, then stops on SIGTERM.
    const result = await run(`require(process.env.TELEMETRY);
      const http = require('node:http'), { metrics, trace } = require('@opentelemetry/api');
      const seen = [];
      const server = http.createServer((req, res) => { seen.push([req.url, Boolean(trace.getActiveSpan()), req.headers.traceparent !== undefined]); res.end('ok'); });
      server.listen(0, '127.0.0.1', async () => {
        const base = 'http://127.0.0.1:' + server.address().port;
        await (await fetch(base + '/work')).text(); await (await fetch(base + '/health/live')).text();
        metrics.getMeter('test').createCounter('test_events').add(1);
        console.log(JSON.stringify(seen)); server.close(); process.kill(process.pid, 'SIGTERM');
        setTimeout(() => process.exit(0), 1500);
      });`, { OTEL_EXPORTER_OTLP_ENDPOINT: endpoint, OTEL_SERVICE_NAME: 'telemetry-test' });
    assert.equal(result.code, 0, result.out);
    const seen = JSON.parse(result.out.trim().split('\n')[0] ?? '[]') as [string, boolean, boolean][];
    // /work runs inside a server span and the fetch carried the trace context; the probe has no span.
    assert.deepEqual(seen, [['/work', true, true], ['/health/live', false, true]]);
    assert.ok(received.includes('/v1/traces'), `no traces in ${JSON.stringify(received)}`);
    assert.ok(received.includes('/v1/metrics'), `no metrics in ${JSON.stringify(received)}`);
  } finally { await new Promise<void>(resolve => collector.close(() => { resolve(); })); }
});
