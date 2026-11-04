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
export function retryDelay(attempt: number, failure: Failure, random: () => number = Math.random): number {
  const jitter = 0.8 + random() * 0.2;
  if (busy(failure)) return Math.ceil(Math.min(failure.retryAfterMs ?? 1000, BUSY_RETRY_MAX_MS) * jitter);
  return Math.ceil(Math.min(30000, 1000 * 2 ** Math.min(attempt - 1, 10)) * jitter);
}
