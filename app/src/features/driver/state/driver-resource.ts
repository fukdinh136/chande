import { ApiError } from '../http/errors';

export interface Resource<T> { data: T | undefined; loading: boolean; error: unknown; checkedAt: number | null }

// Driver-only GET state. A lease is a foreground consumer, not a new request loop.
export class DriverResource<T> {
  private state: Resource<T> = { data: undefined, loading: false, error: null, checkedAt: null };
  private listeners = new Set<() => void>();
  private leases = new Map<symbol, number | null>();
  private request: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private revision = 0;
  private queued = false;
  private failures = 0;
  constructor(private readonly load: (signal: AbortSignal) => Promise<T>, private readonly owns: () => boolean) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  get retained() { return this.leases.size > 0; }
  get observed() { return this.listeners.size > 0; }
  private publish(patch: Partial<Resource<T>>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  retain(intervalMs: number | null = null) {
    const lease = Symbol();
    const first = !this.retained;
    this.leases.set(lease, intervalMs);
    // Another consumer joins the current read. An aborted read must settle
    // before a resumed lease starts its replacement.
    if (first) { if (this.request) this.queued = true; else void this.run(); }
    else this.schedule();
    return () => {
      this.leases.delete(lease);
      if (!this.retained) this.pause(); else this.schedule();
    };
  }
  refresh = () => {
    this.revision++;
    if (this.request) this.queued = true;
    else if (this.retained) void this.run();
  };
  replace = (data: T) => {
    if (!this.owns()) return;
    this.revision++;
    this.publish({ data, loading: !!this.request, error: null, checkedAt: Date.now() });
  };
  private clearTimer() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  private schedule() {
    this.clearTimer();
    if (this.request || !this.retained || !this.owns()) return;
    const intervals = [...this.leases.values()].filter((value): value is number => value !== null);
    if (intervals.length) this.timer = setTimeout(() => { this.timer = null; void this.run(); }, Math.min(60000, Math.min(...intervals) * 2 ** Math.min(this.failures, 3)));
  }
  private async run() {
    if (this.request || !this.retained || !this.owns()) return;
    this.clearTimer();
    const request = new AbortController(), revision = this.revision;
    this.request = request; this.queued = false;
    this.publish({ loading: true });
    const current = () => !request.signal.aborted && revision === this.revision && this.owns();
    try {
      const data = await this.load(request.signal);
      if (current()) { this.failures = 0; this.publish({ data, error: null, checkedAt: Date.now() }); }
    } catch (error) {
      if (current() && !(error instanceof ApiError && error.code === 'CANCELLED')) { this.failures++; this.publish({ error }); }
    } finally {
      if (this.request === request) {
        this.request = null;
        if (this.owns()) this.publish({ loading: false });
        if (this.queued && this.retained && this.owns()) { this.queued = false; void this.run(); }
        else this.schedule();
      }
    }
  }
  pause() {
    this.revision++; this.queued = false; this.clearTimer(); this.request?.abort();
    this.publish({ loading: false });
  }
  clear() {
    this.leases.clear(); this.pause(); this.failures = 0;
    this.publish({ data: undefined, error: null, checkedAt: null });
  }
}
