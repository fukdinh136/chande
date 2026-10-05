import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState } from 'react-native';
import { ApiError } from '../http/errors';

export function useForeground() {
  const [foreground, setForeground] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => listener.remove();
  }, []);
  return foreground;
}
export interface Resource<T> {
  data: T | undefined;
  loading: boolean;
  error: unknown;
  checkedAt: number | null;
}
// At most one GET in flight per focused resource; a queued refresh runs afterward.
export function useFocusedResource<T>(
  load: (signal: AbortSignal) => Promise<T>, enabled = true, intervalMs: number | null = null,
) {
  const foreground = useForeground();
  const [state, setState] = useState<Resource<T>>({ data: undefined, loading: false, error: null, checkedAt: null });
  const trigger = useRef<(() => void) | null>(null);
  const revision = useRef(0);
  const refresh = useCallback(() => trigger.current?.(), []);
  const replace = useCallback((data: T) => {
    revision.current++;
    setState({ data, loading: false, error: null, checkedAt: Date.now() });
  }, []);
  useFocusEffect(useCallback(() => {
    if (!enabled || !foreground) return;
    let active = true, failures = 0, queued = false;
    let request: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = async () => {
      if (!active) return;
      if (request) { queued = true; return; }
      if (timer) { clearTimeout(timer); timer = null; }
      request = new AbortController();
      const observedRevision = revision.current;
      setState((previous) => ({ ...previous, loading: true, error: null }));
      try {
        const data = await load(request.signal);
        if (!active || observedRevision !== revision.current) return;
        failures = 0;
        setState({ data, error: null, loading: false, checkedAt: Date.now() });
      } catch (error) {
        if (!active || observedRevision !== revision.current) return;
        failures++;
        if (!(error instanceof ApiError && error.code === 'CANCELLED')) setState((previous) => ({ ...previous, error, loading: false }));
      } finally {
        request = null;
        if (active && queued) { queued = false; void run(); }
        else if (active && intervalMs !== null) {
          timer = setTimeout(() => { void run(); }, Math.min(60000, intervalMs * 2 ** Math.min(failures, 3)));
        }
      }
    };
    trigger.current = () => { void run(); };
    void run();
    return () => {
      active = false;
      trigger.current = null;
      if (timer) clearTimeout(timer);
      request?.abort();
    };
  }, [enabled, foreground, intervalMs, load]));
  return { ...state, refresh, replace };
}
