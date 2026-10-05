import { createDataSource } from '../src/infrastructure/persistence/connection';
import { PgStore } from '../src/infrastructure/persistence/store';
export async function testDatabase(): Promise<PgStore> {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://trip_test:trip_test@127.0.0.1:55432/trip_test';
  if (!new URL(url).pathname.endsWith('_test')) throw new Error('Tests require a database name ending in _test');
  const db = createDataSource(url); await db.initialize(); await db.runMigrations(); return new PgStore(db);
}
export async function clearDatabase(store: PgStore): Promise<void> {
  const name: { name: string }[] = await store.db.query('SELECT current_database() AS name');
  if (!name[0]?.name.endsWith('_test')) throw new Error('Refusing to clear a non-test database');
  await store.db.query('TRUNCATE outbox_deliveries,outbox,inbox_messages,request_receipts,trip_status_history,trips,trip_quotes RESTART IDENTITY CASCADE');
}
