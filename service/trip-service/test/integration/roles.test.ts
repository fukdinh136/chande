import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '../database';
import { createDataSource } from '../../src/infrastructure/persistence/connection';
import { PgStore } from '../../src/infrastructure/persistence/store';
import { CreateTrip } from '../../src/application/use-cases/create';
import { quote, rider, now } from '../fixtures';
test('separate migration/runtime roles support business writes and deny runtime schema changes', async () => {
  const admin = await testDatabase(); const suffix = randomUUID().replace(/-/g, '');
  const schema = `trip_${suffix}`; const migrator = `migration_${suffix}`; const runtime = `runtime_${suffix}`;
  const sources = [] as ReturnType<typeof createDataSource>[];
  try {
    await admin.db.query(`CREATE ROLE ${migrator} LOGIN PASSWORD 'permission-test'; CREATE ROLE ${runtime} LOGIN PASSWORD 'permission-test'; CREATE SCHEMA ${schema} AUTHORIZATION ${migrator}; GRANT USAGE ON SCHEMA ${schema} TO ${runtime}; ALTER ROLE ${migrator} SET search_path=${schema}; ALTER ROLE ${runtime} SET search_path=${schema}; ALTER DEFAULT PRIVILEGES FOR ROLE ${migrator} IN SCHEMA ${schema} GRANT SELECT,INSERT,UPDATE ON TABLES TO ${runtime}; ALTER DEFAULT PRIVILEGES FOR ROLE ${migrator} IN SCHEMA ${schema} GRANT USAGE,SELECT ON SEQUENCES TO ${runtime}`);
    const connect = async (role: string) => { const url = new URL(String((admin.db.options as { url: string }).url)); url.username = role; url.password = 'permission-test'; const db = createDataSource(url.toString()); sources.push(db); return db.initialize(); };
    const migration = await connect(migrator); await migration.runMigrations();
    const business = new PgStore(await connect(runtime)); assert.equal(await business.ready(), true);
    await business.transaction(tx => tx.saveQuote(quote())); assert.equal((await new CreateTrip(business, { id: randomUUID, now: () => now }).execute(rider, quote().quoteId, randomUUID())).value.status, 'SEARCHING');
    await assert.rejects(business.db.query('ALTER TABLE trips ADD COLUMN runtime_should_not_create integer'), { code: '42501' });
    await assert.rejects(business.db.query('DELETE FROM trips'), { code: '42501' });
  } finally {
    for (const source of sources) if (source.isInitialized) await source.destroy();
    await admin.db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; DROP ROLE IF EXISTS ${runtime}; DROP ROLE IF EXISTS ${migrator}`); await admin.db.destroy();
  }
});
