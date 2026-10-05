import type { Clock, Context } from './ports/clients';
import { deadline, RoutingError } from '../domain/errors';
export function checkpoint(context: Context, clock: Clock): void {
  if (clock.now() >= context.deadline) throw deadline();
  if (context.signal.aborted) throw context.signal.reason instanceof RoutingError ? context.signal.reason : deadline();
}
export function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(deadline()); return; }
    const cancel = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(deadline()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, ms);
    signal.addEventListener('abort', cancel, { once: true });
  });
}
