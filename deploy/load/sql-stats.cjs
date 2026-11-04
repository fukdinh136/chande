// PostgreSQL time per query during a load run, from pg_stat_statements (E3).
//   node deploy/load/sql-stats.cjs reset            clears the counters (and creates the extension if missing)
//   node deploy/load/sql-stats.cjs top --out <file> writes time per database and the 25 most expensive queries
// Queries are normalized by PostgreSQL (values become $1, $2 ...), so the output holds no request data.
const fs = require('node:fs');
const {kubectl, args} = require('./lib.cjs');

const action = process.argv[2];
const options = args({out: '', limit: 25});
const psql = sql => kubectl(['exec', '-i', 'deploy/postgres', '--', 'sh', '-c', 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -tA'], sql).trim();

if (action === 'reset') {
  psql('CREATE EXTENSION IF NOT EXISTS pg_stat_statements; SELECT pg_stat_statements_reset();');
  console.info('SQL stats reset');
} else if (action === 'top') {
  const limit = Math.max(1, Math.min(100, Number(options.limit) || 25));
  const result = JSON.parse(psql(`SELECT json_build_object(
    'byDatabase', (SELECT coalesce(json_agg(t ORDER BY t."totalMs" DESC), '[]') FROM (
      SELECT d.datname, round(sum(s.total_exec_time))::bigint AS "totalMs", sum(s.calls)::bigint AS calls
      FROM pg_stat_statements s JOIN pg_database d ON d.oid = s.dbid GROUP BY d.datname) t),
    'top', (SELECT coalesce(json_agg(t ORDER BY t."totalMs" DESC), '[]') FROM (
      SELECT d.datname, s.calls, round(s.total_exec_time)::bigint AS "totalMs", round(s.mean_exec_time::numeric, 3) AS "meanMs", s.rows,
        left(regexp_replace(s.query, '\\s+', ' ', 'g'), 400) AS query
      FROM pg_stat_statements s JOIN pg_database d ON d.oid = s.dbid ORDER BY s.total_exec_time DESC LIMIT ${limit}) t));`));
  if (options.out) fs.writeFileSync(options.out, JSON.stringify(result, null, 2));
  console.info('SQL ' + JSON.stringify(result.byDatabase));
} else {
  throw new Error('Usage: node deploy/load/sql-stats.cjs reset|top [--out file] [--limit 25]');
}
