// End-of-run checks, written into summary.json by run.cjs:
//   integrity (D6): drivers with two open trips, trips with two held offers. Both must be 0.
//   minutes: per minute of the window, trips that started searching, how many were assigned, p95 searching -> assigned.
//   state: Redis memory and outbox row counts, to see growth across a soak.
//   node deploy/load/checks.cjs --since <ISO> [--until <ISO>] [--out <file>]
const fs = require('node:fs');
const {kubectl, percentile, args} = require('./lib.cjs');

const options = args({since: '', until: '', out: ''});
const iso = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;
if (!iso.test(options.since) || (options.until && !iso.test(options.until))) throw new Error('--since/--until must be ISO UTC timestamps');
const until = options.until || '9999-01-01T00:00:00Z';
const query = (db, sql) => kubectl(['exec', '-i', 'deploy/postgres', '--', 'sh', '-c', `psql -U "$POSTGRES_USER" -d ${db} -tA`], sql).trim();
const count = (db, sql) => Number(query(db, `SELECT count(*) FROM (${sql}) x;`));

const integrity = {
  driversWithTwoOpenTrips: count('trip_db', `SELECT driver_id FROM trips WHERE status IN ('ASSIGNED','DRIVER_ARRIVED','IN_PROGRESS') GROUP BY driver_id HAVING count(*) > 1`),
  tripsWithTwoHeldOffers: count('matching_db', `SELECT trip_id FROM matching_offers WHERE status IN ('PENDING','ASSIGNMENT_PENDING','ASSIGNED') GROUP BY trip_id HAVING count(*) > 1`),
};
integrity.ok = integrity.driversWithTwoOpenTrips === 0 && integrity.tripsWithTwoHeldOffers === 0;

const trips = JSON.parse(query('trip_db', `SELECT coalesce(json_agg(t), '[]') FROM (
  SELECT min((data->>'occurredAt')::timestamptz) FILTER (WHERE data->>'toStatus'='SEARCHING') AS searching,
    min((data->>'occurredAt')::timestamptz) FILTER (WHERE data->>'toStatus'='ASSIGNED') AS assigned
  FROM trip_status_history GROUP BY trip_id
  HAVING min((data->>'occurredAt')::timestamptz) FILTER (WHERE data->>'toStatus'='SEARCHING') BETWEEN '${options.since}' AND '${until}') t;`));
const buckets = new Map();
for (const trip of trips) {
  const minute = new Date(trip.searching).toISOString().slice(0, 16);
  const bucket = buckets.get(minute) ?? {minute, searching: 0, assigned: 0, ms: []};
  bucket.searching++;
  if (trip.assigned) { bucket.assigned++; bucket.ms.push(Date.parse(trip.assigned) - Date.parse(trip.searching)); }
  buckets.set(minute, bucket);
}
const minutes = [...buckets.values()].sort((a, b) => a.minute.localeCompare(b.minute))
  .map(({minute, searching, assigned, ms}) => ({minute, searching, assigned, p95Ms: percentile(ms, 95)}));

const redis = section => kubectl(['exec', 'deploy/redis', '--', 'redis-cli', 'info', section]);
const field = (text, name) => Number((text.match(new RegExp(`^${name}:(\\d+)`, 'm')) ?? [])[1] ?? NaN);
const memory = redis('memory'), stats = redis('stats');
const rows = (db, table) => Number(query(db, `SELECT count(*) FROM ${table};`));
const state = {
  redisUsedMb: Math.round(field(memory, 'used_memory') / 1048576), redisMaxMb: Math.round(field(memory, 'maxmemory') / 1048576),
  evictedKeys: field(stats, 'evicted_keys'),
  tripOutbox: rows('trip_db', 'outbox'), tripOutboxDeliveries: rows('trip_db', 'outbox_deliveries'), matchingOutbox: rows('matching_db', 'matching_outbox'),
};

const result = {integrity, minutes, state};
if (options.out) fs.writeFileSync(options.out, JSON.stringify(result, null, 2));
console.info('INTEGRITY ' + JSON.stringify(integrity));
console.info('STATE ' + JSON.stringify(state));
if (minutes.length > 1) console.info('MINUTES ' + minutes.map(m => `${m.minute.slice(11)} ${m.assigned}/${m.searching} p95=${m.p95Ms}ms`).join(' | '));
