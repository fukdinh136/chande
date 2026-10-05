import type { Config } from '../../bootstrap/config';
import type { Clock, Context, MapDispatcher, MapProvider } from '../../application/ports/clients';
import type { MapJob, RouteRequest, MatrixRequest, Route, Cell } from '../../domain/models';
import type { PermitLimiter } from './limiter';
import { RoutingError, busy, deadline } from '../../domain/errors';
import { checkpoint, wait } from '../../application/context';
type Result = Route | Cell[];
interface Pending { job: MapJob; context: Context; controller: AbortController; resolve: (result: Result) => void; reject: (error: unknown) => void; cleanup: () => void; queueTimer?: ReturnType<typeof setTimeout> }
/** Resolve cancellation even if an injected adapter fails to honour its signal. */
function cancellable<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => { cleanup(); reject(signal.reason instanceof RoutingError ? signal.reason : deadline()); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(operation).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}
export class WorkerPool implements MapDispatcher {
  private queue: Pending[] = []; private active = new Set<Pending>(); private accepting = true;
  private drained: (() => void)[] = [];
  constructor(private readonly provider: MapProvider, private readonly limiter: PermitLimiter, private readonly limits: Config['limits'], private readonly clock: Clock) {}
  get stats() { return { accepting: this.accepting, running: this.active.size, queued: this.queue.length }; }
  dispatch(job: { kind: 'route'; input: RouteRequest }, context: Context): Promise<Route>;
  dispatch(job: { kind: 'matrix'; input: MatrixRequest }, context: Context): Promise<Cell[]>;
  dispatch(job: MapJob, context: Context): Promise<Result>;
  dispatch(job: MapJob, context: Context): Promise<Result> {
    try { checkpoint(context, this.clock); } catch (error) { return Promise.reject(error); }
    if (!this.accepting || (this.active.size >= this.limits.workers && this.queue.length >= this.limits.queueSize)) return Promise.reject(busy());
    return new Promise((resolve, reject) => {
      const controller = new AbortController(); const local = { ...context, signal: controller.signal };
      const cancel = () => controller.abort(context.signal.reason instanceof RoutingError ? context.signal.reason : deadline());
      const timer = setTimeout(cancel, Math.max(1, context.deadline - this.clock.now()));
      const pending: Pending = { job, context: local, controller, resolve, reject, cleanup: () => { clearTimeout(timer); clearTimeout(pending.queueTimer); context.signal.removeEventListener('abort', cancel); controller.signal.removeEventListener('abort', remove); } };
      const remove = () => {
        const index = this.queue.indexOf(pending);
        if (index >= 0) { this.queue.splice(index, 1); pending.cleanup(); reject(controller.signal.reason); }
      };
      context.signal.addEventListener('abort', cancel, { once: true }); controller.signal.addEventListener('abort', remove, { once: true });
      if (this.active.size < this.limits.workers) this.start(pending);
      else {
        this.queue.push(pending);
        pending.queueTimer = setTimeout(() => controller.abort(busy()), Math.min(this.limits.queueWait, context.deadline - this.clock.now()));
      }
    });
  }
  private start(pending: Pending): void {
    clearTimeout(pending.queueTimer); this.active.add(pending);
    void cancellable(() => this.execute(pending.job, pending.context), pending.controller.signal).then(pending.resolve, pending.reject).finally(() => {
      pending.cleanup(); this.active.delete(pending);
      while (this.accepting && this.active.size < this.limits.workers && this.queue.length) this.start(this.queue.shift()!);
      if (!this.active.size) this.drained.splice(0).forEach(resolve => resolve());
    });
  }
  private async execute(job: MapJob, context: Context): Promise<Result> {
    const elements = job.kind === 'matrix' ? job.input.origins.length : 0;
    for (let attempt = 0; ; attempt++) {
      checkpoint(context, this.clock); await this.limiter.acquire(elements, context); checkpoint(context, this.clock);
      try {
        const result = job.kind === 'route' ? await this.provider.route(job.input, context) : await this.provider.matrix(job.input, context);
        checkpoint(context, this.clock); return result;
      } catch (error) {
        checkpoint(context, this.clock);
        if (!(error instanceof RoutingError) || !error.retryable || attempt + 1 >= this.limits.attempts) throw error;
        const backoff = this.limits.retryBase * 2 ** attempt;
        if (this.clock.now() + backoff >= context.deadline) throw deadline();
        await wait(backoff, context.signal);
      }
    }
  }
  async close(): Promise<void> {
    this.accepting = false;
    for (const pending of [...this.queue]) pending.controller.abort(busy());
    if (!this.active.size) return;
    const timer = setTimeout(() => { for (const pending of this.active) pending.controller.abort(busy()); }, this.limits.shutdownGrace);
    try { await new Promise<void>(resolve => this.drained.push(resolve)); } finally { clearTimeout(timer); }
  }
}
