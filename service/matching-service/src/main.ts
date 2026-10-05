import 'reflect-metadata';
import 'dotenv/config';
import { loadConfig } from './bootstrap/config';
import { source, Repository } from './infrastructure/persistence';
import { context, createApi } from './api/app';
async function main() { const c = loadConfig(), db = source(c.databaseUrl); await db.initialize(); const app = await createApi(context(c, new Repository(db)));
  await app.listen(c.port, c.host);
}
void main().catch(() => { console.error('Matching startup failed'); process.exitCode = 1; });
