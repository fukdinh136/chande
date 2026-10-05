import type { DataSource } from 'typeorm';
export async function migrateWithLock(db: DataSource): Promise<void> {
  const runner = db.createQueryRunner(); await runner.connect(); let acquired = false;
  try {
    const rows: { acquired: boolean }[] = await runner.query("SELECT pg_try_advisory_lock(hashtextextended(current_database() || ':trip-migrations',0)) AS acquired");
    acquired = rows[0]?.acquired ?? false; if (!acquired) throw new Error('Another Trip migration job is running');
    await db.runMigrations({ transaction: 'all' });
  } finally { if (acquired) await runner.query("SELECT pg_advisory_unlock(hashtextextended(current_database() || ':trip-migrations',0))"); await runner.release(); }
}
