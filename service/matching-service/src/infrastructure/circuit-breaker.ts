/**
 * Circuit breaker for the calls one service makes to one dependency (proposal D1).
 * The same file is copied into every Node service (HTTP and gRPC clients use it); keep the copies identical.
 *
 * - closed: calls go through. `failureThreshold` failures in a row open the breaker.
 * - open: calls fail at once, without touching the dependency, for `openMs`.
 * - half-open: one trial call goes through. Its success closes the breaker, its failure opens it again.
 *
 * A failure is no response at all (timeout, refused connection) or a 5xx without Retry-After.
 * Every other answer counts as success, including 4xx and busy answers with Retry-After: the dependency
 * answered, and the caller's own retry rules decide what happens next.
 */
export type BreakerState = 'closed' | 'open' | 'half-open';
export interface BreakerOptions {
  failureThreshold?: number;
  openMs?: number;
  now?: () => number;
  onChange?: (dependency: string, state: BreakerState) => void;
}
export const BREAKER_FAILURES = 5;
export const BREAKER_OPEN_MS = 5000;
const log = (dependency: string, state: BreakerState) => { console.warn(JSON.stringify({ event: 'circuit_breaker', dependency, state })); };
/** True when an HTTP answer counts as a failure of the dependency. */
export const failedStatus = (status: number, retryAfter: string | null) => status >= 500 && !retryAfter;
export class CircuitBreaker {
  private failures = 0; private openUntil = 0; private trial = false; private current: BreakerState = 'closed';
  private readonly threshold: number; private readonly openMs: number; private readonly now: () => number; private readonly onChange: (dependency: string, state: BreakerState) => void;
  constructor(readonly dependency: string, options: BreakerOptions = {}) {
    this.threshold = options.failureThreshold ?? BREAKER_FAILURES; this.openMs = options.openMs ?? BREAKER_OPEN_MS;
    this.now = options.now ?? Date.now; this.onChange = options.onChange ?? log;
  }
  get state(): BreakerState { return this.current === 'open' && this.now() >= this.openUntil ? 'half-open' : this.current; }
  /**
   * 0 when the call may go ahead; the caller then reports how it went with `success()` or `failure()`.
   * Otherwise the call must fail now, and the result is how many ms until the breaker lets a trial call through.
   */
  acquire(): number {
    if (this.current === 'closed') return 0;
    const now = this.now();
    if (this.current === 'open') { if (now < this.openUntil) return this.openUntil - now; this.set('half-open'); }
    if (this.trial) return Math.min(1000, this.openMs);
    this.trial = true; return 0;
  }
  success() { if (this.current === 'open') return; this.failures = 0; this.trial = false; this.set('closed'); }
  failure() {
    if (this.current === 'open') return;
    this.failures++;
    if (this.current === 'half-open' || this.failures >= this.threshold) { this.trial = false; this.openUntil = this.now() + this.openMs; this.set('open'); }
  }
  private set(state: BreakerState) { if (this.current === state) return; this.current = state; this.onChange(this.dependency, state); }
}
