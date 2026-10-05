import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from '../database';
import { migrateWithLock } from '../../src/bootstrap/migrations';
test('migration job refuses a concurrent migration and releases its session lock', async () => {
  const store = await testDatabase(); const runner = store.db.createQueryRunner(); await runner.connect();
  try {
    await runner.query("SELECT pg_advisory_lock(hashtextextended(current_database() || ':trip-migrations',0))");
    await assert.rejects(migrateWithLock(store.db), /Another Trip migration/);
    await runner.query("SELECT pg_advisory_unlock(hashtextextended(current_database() || ':trip-migrations',0))");
    await migrateWithLock(store.db); await migrateWithLock(store.db);
  } finally { await runner.release(); await store.db.destroy(); }
});
