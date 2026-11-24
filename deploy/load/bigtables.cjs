// D5: outbox tables with a million rows. Old delivered rows are what the retention purge must delete while traffic runs.
//   node deploy/load/bigtables.cjs load --rows 1000000   (Trip outbox + one delivered delivery each, Matching published rows;
//                                                         created/published 25 h ago, so older than the 24 h retention)
//   node deploy/load/bigtables.cjs explain --out <file>  (EXPLAIN ANALYZE BUFFERS of both claims and both purges, rolled back)
//   node deploy/load/bigtables.cjs counts
// Synthetic rows point at existing trips (foreign key) and carry {"synthetic":true} in the payload.
const fs = require('node:fs');
const {kubectl, args} = require('./lib.cjs');

const [command = 'counts'] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const options = args({rows: 1000000, out: ''});
const psql = (db, sql) => kubectl(['exec', '-i', 'deploy/postgres', '--', 'sh', '-c', `psql -U "$POSTGRES_USER" -d ${db} -tA -v ON_ERROR_STOP=1`], sql).trim();

function counts() {
  const trip = psql('trip_db', `SELECT json_build_object('outbox', (SELECT count(*) FROM outbox), 'outboxOld', (SELECT count(*) FROM outbox WHERE created_at < now() - interval '24 hours'),
    'deliveries', (SELECT count(*) FROM outbox_deliveries), 'pending', (SELECT count(*) FROM outbox_deliveries WHERE status IN ('pending','processing')),
    'outboxMb', pg_total_relation_size('outbox') / 1048576, 'deliveriesMb', pg_total_relation_size('outbox_deliveries') / 1048576);`);
  const matching = psql('matching_db', `SELECT json_build_object('outbox', (SELECT count(*) FROM matching_outbox), 'old', (SELECT count(*) FROM matching_outbox WHERE published_at < now() - interval '24 hours'),
    'unpublished', (SELECT count(*) FROM matching_outbox WHERE published_at IS NULL), 'mb', pg_total_relation_size('matching_outbox') / 1048576);`);
  return {trip: JSON.parse(trip), matching: JSON.parse(matching)};
}

function load(rows) {
  const batch = 100000;
  for (let done = 0; done < rows; done += batch) {
    const n = Math.min(batch, rows - done);
    // One message per row, spread over existing trips; each has a single delivered Gateway delivery.
    psql('trip_db', `WITH t AS (SELECT array_agg(id) AS ids FROM (SELECT id FROM trips LIMIT 10000) x),
      o AS (INSERT INTO outbox(id, trip_id, trip_version, kind, payload, created_at)
        SELECT gen_random_uuid(), t.ids[1 + (g % array_length(t.ids, 1))], 1, 'event', '{"synthetic":true}'::jsonb, now() - interval '25 hours' - g * interval '1 millisecond'
        FROM t, generate_series(1, ${n}) g RETURNING id)
      INSERT INTO outbox_deliveries(outbox_id, destination, status, attempts, next_retry_at) SELECT id, 'gateway', 'delivered', 1, now() - interval '25 hours' FROM o;`);
    psql('matching_db', `INSERT INTO matching_outbox(id, payload, attempts, due_at, published_at)
      SELECT gen_random_uuid(), '{"synthetic":true}'::jsonb, 1, now() - interval '25 hours', now() - interval '25 hours' - g * interval '1 millisecond' FROM generate_series(1, ${n}) g;`);
    console.info(`loaded ${done + n}/${rows}`);
  }
  psql('trip_db', 'ANALYZE outbox; ANALYZE outbox_deliveries;'); psql('matching_db', 'ANALYZE matching_outbox;');
}

// The same statements the services run (trip-service outbox/repository.ts, matching-service publisher.ts and persistence.ts).
const EXPLAIN = 'EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ';
const statements = {
  tripClaim: ['trip_db', `WITH picked AS (SELECT id FROM outbox_deliveries WHERE (status='pending' AND next_retry_at<=now()) OR (status='processing' AND lease_until<=now()) ORDER BY next_retry_at,id FOR UPDATE SKIP LOCKED LIMIT 100),
    claimed AS (UPDATE outbox_deliveries d SET status='processing',attempts=d.attempts+1,lease_owner=gen_random_uuid(),lease_until=now()+interval '30 seconds' FROM picked p WHERE d.id=p.id RETURNING d.*)
    SELECT c.id FROM claimed c JOIN outbox o ON o.id=c.outbox_id`],
  tripPurge: ['trip_db', `WITH done AS (SELECT o.id FROM outbox o WHERE o.created_at < now() - interval '24 hours'
      AND NOT EXISTS (SELECT 1 FROM outbox_deliveries d WHERE d.outbox_id=o.id AND d.status NOT IN ('delivered','skipped')) ORDER BY o.created_at LIMIT 1000 FOR UPDATE SKIP LOCKED),
    deliveries AS (DELETE FROM outbox_deliveries d USING done WHERE d.outbox_id=done.id) DELETE FROM outbox o USING done WHERE o.id=done.id`],
  matchingClaim: ['matching_db', `WITH due AS (SELECT id FROM matching_outbox WHERE published_at IS NULL AND due_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp()) ORDER BY due_at LIMIT 50 FOR UPDATE SKIP LOCKED),
    claimed AS (UPDATE matching_outbox o SET lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds',attempts=o.attempts+1 FROM due WHERE o.id=due.id RETURNING o.id) SELECT id FROM claimed`],
  // Before 2026-11-18 the cutoff was clock_timestamp() - ..., which could not bound the index scan (254 ms, nothing deleted).
  matchingPurge: ['matching_db', `DELETE FROM matching_outbox WHERE id IN (SELECT id FROM matching_outbox WHERE published_at < now() - interval '24 hours' ORDER BY published_at LIMIT 1000)`],
};
function explain() {
  const plans = {};
  for (const [name, [db, sql]] of Object.entries(statements)) {
    const text = psql(db, `BEGIN; ${EXPLAIN}${sql}; ROLLBACK;`).split('\n').filter(l => !/^(BEGIN|ROLLBACK)$/.test(l)).join('\n');
    plans[name] = {executionMs: Number((text.match(/Execution Time: ([\d.]+) ms/) ?? [])[1]), plan: text};
    console.info(`${name}: ${plans[name].executionMs} ms`);
  }
  return plans;
}

const result = command === 'load' ? (load(options.rows), counts()) : command === 'explain' ? {counts: counts(), plans: explain()} : counts();
if (options.out) fs.writeFileSync(options.out, JSON.stringify(result, null, 2));
if (command !== 'explain') console.info(JSON.stringify(result));
