import 'dotenv/config';
import { loadConfig } from './bootstrap/config';
import { migrateWithLock } from './bootstrap/migrations';
import { createDataSource } from './infrastructure/persistence/connection';
async function main() {
  const config = loadConfig(process.env, 'migration'); const db = await createDataSource(config.databaseUrl, Math.max(2, config.poolSize)).initialize();
  try { await migrateWithLock(db); console.info(JSON.stringify({ event: 'migrations_applied' })); } finally { await db.destroy(); }
}
void main().catch(() => { console.error('Migration failed; check database, migration role and concurrent jobs'); process.exitCode = 1; });
