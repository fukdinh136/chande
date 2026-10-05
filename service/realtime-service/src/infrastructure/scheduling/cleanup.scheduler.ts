import { CleanupStale } from '../../application/use-cases/cleanup-stale';
export class CleanupScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  constructor(private readonly cleanup: CleanupStale, private readonly intervalMs: number) {}
  onModuleInit() {
    this.timer = setInterval(() => { void this.tick(); }, this.intervalMs);
    this.timer.unref();
  }
  private async tick() {
    if (this.running) return;
    this.running = true;
    try { await this.cleanup.execute(); }
    catch { /* Read paths still enforce freshness. Readiness reports Redis failures. */ }
    finally { this.running = false; }
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}
