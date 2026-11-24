import { MatchingError } from '../domain/models';
/** What failed in a matching job, for the retry log and the retry delay. */
export interface Failure { dependency: string; code: string; status: number | null; retryAfterMs: number | null }
export function describeFailure(error: unknown): Failure {
  if (error instanceof MatchingError) return { dependency: 'matching', code: error.code, status: error.status, retryAfterMs: null };
  if (error instanceof Error && 'dependency' in error && 'code' in error && 'status' in error) {
    const e = error as Error & { dependency: string; code: string; status: number; retryAfterMs?: number | null };
    return { dependency: e.dependency, code: e.code, status: e.status || null, retryAfterMs: e.retryAfterMs ?? null };
  }
  if (error instanceof Error && error.name === 'TimeoutError') return { dependency: 'unknown', code: 'TIMEOUT', status: null, retryAfterMs: null };
  return { dependency: 'unknown', code: 'UNEXPECTED', status: null, retryAfterMs: null };
}
/** Busy or rate-limited dependencies are retried soon (their Retry-After, at most this long) instead of backing off to 30 s. */
export const BUSY_RETRY_MAX_MS = 2000;
export const busy = (f: Failure) => f.code === 'ROUTING_BUSY' || f.status === 429 || f.retryAfterMs !== null;
/** `fast` false (the retry budget is spent) sends a busy failure down the exponential backoff like any other. */
export function retryDelay(attempt: number, failure: Failure, random: () => number = Math.random, fast = true): number {
  const jitter = 0.8 + random() * 0.2;
  if (fast && busy(failure)) return Math.ceil(Math.min(failure.retryAfterMs ?? 1000, BUSY_RETRY_MAX_MS) * jitter);
  return Math.ceil(Math.min(30000, 1000 * 2 ** Math.min(attempt - 1, 10)) * jitter);
}
/**
 * Caps the soon retries of busy dependencies (D1): in the last `windowMs`, at most `ratio` of the jobs run,
 * but always at least `floor`. Without a cap, every job keeps retrying a dependency that is already
 * overloaded or behind an open circuit breaker every 2 s. Retries past the cap back off exponentially.
 */
export class RetryBudget {
  private jobs = 0; private retries = 0; private lastJobs = 0; private lastRetries = 0; private start: number;
  constructor(private readonly ratio = 0.2, private readonly floor = 20, private readonly windowMs = 10000, private readonly now: () => number = Date.now) { this.start = now(); }
  /** Counts one job run. */
  job() { this.roll(); this.jobs++; }
  /** True, and counts it, when one more soon retry fits the budget. */
  trySpend(): boolean {
    this.roll();
    // The previous window counts by how much of it still lies inside the last `windowMs`.
    const weight = 1 - (this.now() - this.start) / this.windowMs;
    const jobs = this.jobs + this.lastJobs * weight, retries = this.retries + this.lastRetries * weight;
    if (retries + 1 > Math.max(this.floor, this.ratio * jobs)) return false;
    this.retries++; return true;
  }
  private roll() {
    const passed = Math.floor((this.now() - this.start) / this.windowMs); if (passed <= 0) return;
    this.lastJobs = passed === 1 ? this.jobs : 0; this.lastRetries = passed === 1 ? this.retries : 0;
    this.jobs = 0; this.retries = 0; this.start += passed * this.windowMs;
  }
}
