// Splits SEARCHING -> ASSIGNED into its stages from DB timestamps, for trips that started searching after --since.
//   node deploy/load/segments.cjs --since 2026-11-04T05:00:00Z [--until <ISO>] [--out <file>]
// Stages: Matching creates the first offer; that offer is published to RabbitMQ; the driver accepts
// (ASSIGNMENT_PENDING written by matching-api); Trip records ASSIGNED.
const fs = require('node:fs');
const {kubectl, percentile, args} = require('./lib.cjs');

const options = args({since: '', until: '', out: ''});
const iso = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;
if (!iso.test(options.since) || (options.until && !iso.test(options.until))) throw new Error('--since/--until must be ISO UTC timestamps');
const until = options.until || '9999-01-01T00:00:00Z';
const query = (db, sql) => JSON.parse(kubectl(['exec', '-i', 'deploy/postgres', '--', 'sh', '-c', `psql -U "$POSTGRES_USER" -d ${db} -tA`], sql).trim());

const trips = query('trip_db', `SELECT coalesce(json_agg(t), '[]') FROM (
  SELECT trip_id,
    min((data->>'occurredAt')::timestamptz) FILTER (WHERE data->>'toStatus'='SEARCHING') AS searching,
    min((data->>'occurredAt')::timestamptz) FILTER (WHERE data->>'toStatus'='ASSIGNED') AS assigned
  FROM trip_status_history GROUP BY trip_id
  HAVING min((data->>'occurredAt')::timestamptz) FILTER (WHERE data->>'toStatus'='SEARCHING') BETWEEN '${options.since}' AND '${until}') t;`);

// Per trip: the first offer and when it was published; for the accepted offer, when it was published and accepted.
const offers = query('matching_db', `WITH o AS (
    SELECT id, trip_id, (data->>'createdAt')::timestamptz AS created FROM matching_offers
    WHERE (data->>'createdAt')::timestamptz >= '${options.since}'),
  pub AS (SELECT payload->>'offerId' AS offer_id, min(published_at) AS at FROM matching_outbox
    WHERE payload->>'type' = 'DRIVER_TRIP_OFFER' GROUP BY 1),
  acc AS (SELECT payload->>'offerId' AS offer_id, min(due_at) AS at FROM matching_outbox
    WHERE payload->>'type' = 'DRIVER_TRIP_OFFER_UPDATED' AND payload->>'status' = 'ASSIGNMENT_PENDING' GROUP BY 1)
  SELECT coalesce(json_agg(t), '[]') FROM (
    SELECT o.trip_id,
      (array_agg(o.created ORDER BY o.created))[1] AS offered,
      (array_agg(pub.at ORDER BY o.created))[1] AS published,
      min(acc.at) AS accepted,
      min(pub.at) FILTER (WHERE acc.at IS NOT NULL) AS accepted_offer_published
    FROM o LEFT JOIN pub ON pub.offer_id = o.id::text LEFT JOIN acc ON acc.offer_id = o.id::text
    GROUP BY o.trip_id) t;`);

const byTrip = new Map(offers.map(o => [o.trip_id, o]));
const gap = (from, to) => (from && to ? Date.parse(to) - Date.parse(from) : null);
const stages = {searchingToOffer: [], offerToPublish: [], publishToAccept: [], acceptToAssigned: [], searchingToAssigned: []};
for (const t of trips) {
  const o = byTrip.get(t.trip_id) ?? {};
  const add = (name, v) => { if (v !== null) stages[name].push(v); };
  add('searchingToOffer', gap(t.searching, o.offered));
  add('offerToPublish', gap(o.offered, o.published));
  add('publishToAccept', gap(o.accepted_offer_published, o.accepted));
  add('acceptToAssigned', gap(o.accepted, t.assigned));
  add('searchingToAssigned', gap(t.searching, t.assigned));
}
const ms = v => ({count: v.length, p50: percentile(v, 50), p95: percentile(v, 95), max: v.length ? Math.max(...v) : null});
const result = {since: options.since, until: options.until || null, trips: trips.length, offered: offers.length, ...Object.fromEntries(Object.entries(stages).map(([k, v]) => [k, ms(v)]))};
if (options.out) fs.writeFileSync(options.out, JSON.stringify(result, null, 2));
console.info('SEGMENTS ' + JSON.stringify(result));
