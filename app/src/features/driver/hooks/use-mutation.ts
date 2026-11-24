import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionManager } from '../session/session-manager';

export function useMutation(session: SessionManager) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const locked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const run = useCallback(async (job: (isCurrent: () => boolean) => Promise<void>, message?: string) => {
    if (locked.current) return false;
    locked.current = true;
    const owner = session.getOwnerEpoch();
    const isCurrent = () => mounted.current && owner === session.getOwnerEpoch();
    if (mounted.current) { setBusy(true); setError(null); setNotice(null); }
    try {
      await job(isCurrent);
      if (isCurrent() && message) setNotice(message);
      return true;
    } catch (failure) {
      if (isCurrent()) setError(failure);
      return false;
    } finally {
      locked.current = false;
      if (isCurrent()) setBusy(false);
    }
  }, [session]);
  const clearError = useCallback(() => setError(null), []);
  return { busy, error, notice, run, clearError };
}
