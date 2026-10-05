import type { Clock, Context } from '../../application/ports/clients';
import { checkpoint, wait } from '../../application/context';
import { busy } from '../../domain/errors';
export interface PermitLimiter { acquire(elements: number, context: Context): Promise<void> }
/** Atomic per-process token bucket plus a sliding one-minute matrix budget. */
export class RateLimiter implements PermitLimiter {
  private tokens: number; private updated: number;
  private elements: { at: number; count: number }[] = [];
  constructor(private readonly limits: { rps: number; burst: number; elementsPerMinute: number; rateWait: number }, private readonly clock: Clock,
    private readonly sleep: typeof wait = wait) { this.tokens = limits.burst; this.updated = clock.now(); }
  async acquire(count: number, context: Context): Promise<void> {
    if (!Number.isInteger(count) || count < 0 || count > this.limits.elementsPerMinute) throw busy();
    const end = Math.min(context.deadline, this.clock.now() + this.limits.rateWait);
    while (true) {
      checkpoint(context, this.clock); const now = this.clock.now();
      this.tokens = Math.min(this.limits.burst, this.tokens + Math.max(0, now - this.updated) * this.limits.rps / 1000); this.updated = now;
      this.elements = this.elements.filter(x => now - x.at < 60000);
      const remaining = this.limits.elementsPerMinute - this.elements.reduce((s, x) => s + x.count, 0);
      if (this.tokens >= 1 && remaining >= count) {
        this.tokens -= 1; if (count) this.elements.push({ at: now, count }); return;
      }
      const tokenWait = Math.max(0, (1 - this.tokens) * 1000 / this.limits.rps);
      const elementWait = remaining < count ? this.elements[0]!.at + 60000 - now : 0;
      const pause = Math.max(1, Math.ceil(Math.max(tokenWait, elementWait)));
      if (now + pause > end) throw busy();
      await this.sleep(pause, context.signal);
    }
  }
}
