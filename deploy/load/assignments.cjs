// Reports trip assignment from trip_db for trips that started searching after --since.
//   node deploy/load/assignments.cjs --since 2026-10-29T04:00:00Z --wait 900 --out <file>
// With --wait N it keeps polling every 15 s until no trip is SEARCHING or N seconds pass.
const fs = require('node:fs');
const {kubectl, pause, percentile, args} = require('./lib.cjs');

const options = args({since: '', wait: 0, out: ''});
if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(options.since)) throw new Error('--since must be an ISO UTC timestamp');

// One row per trip: when it started searching, when it was assigned (if ever) and its latest status.
const sql = `SELECT coalesce(json_agg(t), '[]') FROM (
  SELECT trip_id,
    min((data->>'occurredAt')::timestamptz) FILTER (WHERE data->>'toStatus'='SEARCHING') AS searching,
    min((data->>'occurredAt')::timestamptz) FILTER (WHERE data->>'toStatus'='ASSIGNED') AS assigned,
    (array_agg(data->>'toStatus' ORDER BY version DESC))[1] AS status
  FROM trip_status_history GROUP BY trip_id
  HAVING min((data->>'occurredAt')::timestamptz) FILTER (WHERE data->>'toStatus'='SEARCHING') >= '${options.since}') t;`;
const read = () => JSON.parse(kubectl(['exec', '-i', 'deploy/postgres', '--', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d trip_db -tA'], sql).trim());

function report(rows) {
  const at = r => Date.parse(r.searching), waits = rows.filter(r => r.assigned).map(r => Date.parse(r.assigned) - at(r));
  const statuses = rows.reduce((m, r) => ({...m, [r.status]: (m[r.status] ?? 0) + 1}), {});
  const start = Math.min(...rows.map(at)), perMinute = {};
  for (const r of rows.filter(r => r.assigned)) { const minute = Math.floor((Date.parse(r.assigned) - start) / 60000); perMinute[minute] = (perMinute[minute] ?? 0) + 1; }
  const ms = v => ({p50: percentile(v, 50), p95: percentile(v, 95), max: v.length ? Math.max(...v) : null});
  return {trips: rows.length, assigned: waits.length, statuses, searchingToAssignedMs: ms(waits),
    firstSearching: rows.length ? new Date(start).toISOString() : null, assignedPerMinute: perMinute};
}

(async () => {
  const deadline = Date.now() + options.wait * 1000;
  let result = report(read());
  while (options.wait && (result.statuses.SEARCHING ?? 0) > 0 && Date.now() < deadline) {
    console.info(`assignments trips=${result.trips} assigned=${result.assigned} searching=${result.statuses.SEARCHING ?? 0} p95=${result.searchingToAssignedMs.p95}ms`);
    await pause(15000); result = report(read());
  }
  if (options.out) fs.writeFileSync(options.out, JSON.stringify(result, null, 2));
  console.info('ASSIGNMENTS ' + JSON.stringify(result));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
