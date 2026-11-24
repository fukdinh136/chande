import type { DataSource, QueryRunner } from 'typeorm';
/**
 * Leader Election over a PostgreSQL session advisory lock. Among the replicas of a worker, the one holding the
 * lock is the leader and alone runs a job that needs only one runner (the outbox purge).
 * The lock lives on one dedicated connection taken from the pool. When that process or connection dies,
 * PostgreSQL releases the lock and another replica becomes leader on its next `lead()`.
 * The same file is copied into Trip and Matching; keep the copies identical.
 */
export type LeaderEvent = { event: 'leader_elected' | 'leader_lost'; job: string };
export class LeaderElection {
  private runner?: QueryRunner;
  constructor(private readonly db: Pick<DataSource, 'createQueryRunner'>, readonly job: string, private readonly report: (event: LeaderEvent) => void = e => { console.info(JSON.stringify(e)); }) {}
  get leader() { return this.runner !== undefined; }
  /** True when this replica is the leader: it still holds the lock, or has just taken it. */
  async lead(): Promise<boolean> {
    if (this.runner) {
      try { await this.runner.query('SELECT 1'); return true; }
      catch { await this.drop(); this.report({ event: 'leader_lost', job: this.job }); }
    }
    const runner = this.db.createQueryRunner();
    try {
      await runner.connect();
      const rows: { ok: boolean }[] = await runner.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS ok', [this.key]);
      if (rows[0]?.ok === true) { this.runner = runner; this.report({ event: 'leader_elected', job: this.job }); return true; }
    } catch { /* the database is unreachable: not the leader this round */ }
    await runner.release().catch(() => {});
    return false;
  }
  /** Gives up leadership so another replica can take over at once (on shutdown). */
  async resign() {
    if (!this.runner) return;
    await this.runner.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [this.key]).catch(() => {});
    await this.drop();
  }
  private get key() { return 'leader:' + this.job; }
  private async drop() { const runner = this.runner; this.runner = undefined; await runner?.release().catch(() => {}); }
}
