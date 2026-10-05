import type { Config } from '../bootstrap/config';
import { Repository } from '../infrastructure/persistence';
import { MatchDriver } from './match';
import { AssignDriver } from './decisions';
export class MatchingWorker {
  private busy = false;
  lastProgress = 0;
  constructor(private readonly repo: Repository, private readonly match: MatchDriver, private readonly assign: AssignDriver, private readonly c: Pick<Config, 'workers' | 'leaseMs'>) {}
  async tick() {
    if (this.busy) return; this.busy = true;
    try {
      const claims = await this.repo.claim(this.c.workers, this.c.leaseMs);
      await Promise.all(claims.map(async job => {
        const renewal = setInterval(() => { void this.repo.db.query("UPDATE matching_searches SET lease_until=clock_timestamp()+$3*interval '1 millisecond' WHERE trip_id=$1 AND lease_id=$2", [job.trip_id, job.lease_id, this.c.leaseMs]).catch(() => {}); }, this.c.leaseMs / 3);
        try {
          const s = await this.repo.getSearch(job.trip_id); if (s?.status === 'ASSIGNMENT_PENDING') await this.assign.execute(job.trip_id); else await this.match.execute(job.trip_id);
          await this.repo.finishLease(job.trip_id, job.lease_id);
        } catch {
          let delay = 1000;
          await this.repo.transaction(async tx => { const s = await tx.search(job.trip_id); if (!s) return; s.attempts++; delay = Math.ceil(Math.min(30000, 1000 * 2 ** Math.min(s.attempts - 1, 10)) * (0.8 + Math.random() * 0.2)); await tx.saveSearch(s, delay); });
          await this.repo.finishLease(job.trip_id, job.lease_id, delay);
          console.warn(JSON.stringify({ event: 'matching_job_retry', tripId: job.trip_id, delayMs: delay }));
        } finally { clearInterval(renewal); }
      })); this.lastProgress = Date.now();
    } finally { this.busy = false; }
  }
}
