/**
 * Runs `purge` every `intervalMs`. A full batch means more old rows are waiting, so the next batch runs right away;
 * a failed run is reported and retried on the next interval. Returns a stop function that waits for the running batch.
 */
export function startPurge(purge: () => Promise<number>, batch: number, intervalMs: number, report: (event: Record<string, unknown>) => void = e => console.info(JSON.stringify(e))) {
  let stopping = false; let timer: NodeJS.Timeout | undefined; let current: Promise<void> = Promise.resolve();
  const run = () => {
    if (stopping) return; timer = undefined;
    current = (async () => {
      let total = 0;
      try { for (let n = batch; n >= batch && !stopping;) { n = await purge(); total += n; } if (total) report({ event: 'outbox_purged', rows: total }); }
      catch { report({ event: 'outbox_purge_failed', rows: total }); }
      if (!stopping) timer = setTimeout(run, intervalMs);
    })();
  };
  timer = setTimeout(run, 0);
  return async () => { stopping = true; if (timer) clearTimeout(timer); await current; };
}
