/**
 * Runs `work` again right away while it reports more work, and rests `restMs` once it reports idle
 * or throws (so a failing dependency never causes a hot loop). `wake()` cuts a rest short, or, when a
 * run is in progress, makes the next run start right after it.
 */
export class DrainLoop {
  private timer?: NodeJS.Timeout; private immediate?: NodeJS.Immediate; private running?: Promise<void>;
  private stopped = true; private woken = false;
  constructor(private readonly work: () => Promise<boolean>, private readonly restMs: number, private readonly onError: (error: unknown) => void = () => {}) {}
  start() { if (!this.stopped) return; this.stopped = false; this.run(); }
  wake() {
    if (this.stopped) return;
    if (this.running) { this.woken = true; return; }
    if (this.timer) { clearTimeout(this.timer); this.run(); }
  }
  async stop() {
    this.stopped = true; if (this.timer) clearTimeout(this.timer); if (this.immediate) clearImmediate(this.immediate);
    this.timer = undefined; this.immediate = undefined; await this.running;
  }
  private run() {
    this.timer = undefined; this.immediate = undefined; this.woken = false;
    this.running = this.work().then(more => more, (error: unknown) => { this.onError(error); return undefined; }).then(more => {
      this.running = undefined;
      if (this.stopped) return;
      if (more === undefined || !(more || this.woken)) this.timer = setTimeout(() => this.run(), this.restMs);
      else this.immediate = setImmediate(() => this.run());
    });
  }
}
