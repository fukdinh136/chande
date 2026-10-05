import 'reflect-metadata';
import 'dotenv/config';
import { source } from './infrastructure/persistence';
async function main() { if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required'); const db = source(process.env.DATABASE_URL); await db.initialize(); try { await db.runMigrations(); } finally { await db.destroy(); } }
void main().catch(() => { console.error('Matching migration failed'); process.exitCode = 1; });
