import { useEffect, useSyncExternalStore } from 'react';
import { useDriverForeground } from '../hooks/use-driver-foreground';
import type { DriverGpsSession } from './gps-session';

export function useDriverGps(manager: DriverGpsSession, publishing: boolean) {
  const foreground = useDriverForeground();
  const state = useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getSnapshot);
  const requested = state.requested;
  useEffect(() => {
    manager.configure(requested, foreground, publishing);
    return manager.stop;
  }, [manager, requested, foreground, publishing]);
  return { ...state, requested, foreground, publishing, retry: manager.retry, setRequested: manager.setRequested, limits: manager.limits };
}
