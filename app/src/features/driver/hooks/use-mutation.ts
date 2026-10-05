import { useCallback, useEffect, useRef, useState } from 'react';

export function useMutation() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const locked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const run = useCallback(async (job: () => Promise<void>, message?: string) => {
    if (locked.current) return false;
    locked.current = true;
    if (mounted.current) { setBusy(true); setError(null); setNotice(null); }
    try {
      await job();
      if (mounted.current && message) setNotice(message);
      return true;
    } catch (failure) {
      if (mounted.current) setError(failure);
      return false;
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);
  return { busy, error, notice, run };
}
