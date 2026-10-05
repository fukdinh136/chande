import type { Clock, Context } from './ports/clients';
import { deadline } from '../domain/errors';
export function checkpoint(context: Context, clock: Clock): void {
  if (context.signal.aborted || clock.now() >= context.deadline) throw deadline();
}
export function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(deadline()); return; }
    const cancel = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(deadline()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, ms);
    signal.addEventListener('abort', cancel, { once: true });
  });
}
