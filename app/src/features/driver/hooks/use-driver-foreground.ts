import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

// One native listener for Driver consumers; Customer's existing hook is unchanged.
const listeners = new Set<() => void>();
let subscription: ReturnType<typeof AppState.addEventListener> | null = null;
const foreground = () => AppState.currentState === 'active';
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!subscription) subscription = AppState.addEventListener('change', () => { for (const notify of listeners) notify(); });
  return () => { listeners.delete(listener); if (!listeners.size) { subscription?.remove(); subscription = null; } };
}
export function useDriverForeground() { return useSyncExternalStore(subscribe, foreground, foreground); }
