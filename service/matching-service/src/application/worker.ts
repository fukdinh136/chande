import type { Config } from '../bootstrap/config';
import { Repository } from '../infrastructure/persistence';
import { MatchDriver } from './match';
import { AssignDriver } from './decisions';
import { describeFailure, retryDelay } from './retry';
type Job = { trip_id: string; lease_id: string };
/**
 * Keeps up to `workers` search jobs running (ADR-0008). Whenever a slot frees up it claims more due
 * searches right away, so one slow job never holds back the others. It rests `scanMs` only when nothing
 * is due or a claim fails; `wake()` cuts that rest short.
 */
export class MatchingWorker {
  lastProgress = 0;
  private readonly active = new Set<Promise<void>>();
  private stopped = true; private again = false; private filling?: Promise<void>; private timer?: NodeJS.Timeout;
  constructor(private readonly repo: Repository, private readonly match: MatchDriver, private readonly assign: AssignDriver, private readonly c: Pick<Config, 'workers' | 'leaseMs' | 'scanMs'>, private readonly onError: (error: unknown) => void = () => {}) {}
  get running() { return this.active.size; }
  start() { if (!this.stopped) return; this.stopped = false; this.wake(); }
  wake() {
    if (this.stopped) return;
    if (this.filling) { this.again = true; return; }
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    this.filling = this.fill().finally(() => { this.filling = undefined; if (this.again) { this.again = false; this.wake(); } });
  }
  /** Stops claiming and waits for the jobs already running. */
  async stop() {
    this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = undefined;
    await this.filling; await Promise.all([...this.active]);
  }
  private async fill() {
    const free = this.c.workers - this.active.size; if (free <= 0) return;
    let claims: Job[];
    try { claims = await this.repo.claim(free, this.c.leaseMs); } catch (error) { this.onError(error); this.rest(); return; }
    this.lastProgress = Date.now();
    for (const job of claims) {
      const run: Promise<void> = this.run(job).catch(error => { this.onError(error); }).finally(() => { this.active.delete(run); this.lastProgress = Date.now(); this.wake(); });
      this.active.add(run);
    }
    // Fewer claims than free slots means the queue is drained for now; a finishing job wakes us otherwise.
    if (claims.length < free) this.rest();
  }
  private rest() {
    if (this.stopped) return; if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = undefined; this.wake(); }, this.c.scanMs);
  }
  private async run(job: Job) {
    const renewal = setInterval(() => { void this.repo.db.query("UPDATE matching_searches SET lease_until=clock_timestamp()+$3*interval '1 millisecond' WHERE trip_id=$1 AND lease_id=$2", [job.trip_id, job.lease_id, this.c.leaseMs]).catch(() => {}); }, this.c.leaseMs / 3);
    try {
      const s = await this.repo.getSearch(job.trip_id); if (s?.status === 'ASSIGNMENT_PENDING') await this.assign.execute(job.trip_id); else await this.match.execute(job.trip_id);
      await this.repo.finishLease(job.trip_id, job.lease_id);
    } catch (error) {
      const failure = describeFailure(error); let delay = 1000, attempt = 0;
      await this.repo.transaction(async tx => { const s = await tx.search(job.trip_id); if (!s) return; attempt = ++s.attempts; delay = retryDelay(attempt, failure); await tx.saveSearch(s, delay); });
      await this.repo.finishLease(job.trip_id, job.lease_id, delay);
      console.warn(JSON.stringify({ event: 'matching_job_retry', tripId: job.trip_id, attempt, delayMs: delay, dependency: failure.dependency, code: failure.code, status: failure.status }));
    } finally { clearInterval(renewal); }
  }
}
