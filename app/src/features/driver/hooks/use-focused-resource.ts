import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState } from 'react-native';
import type { DriverResource } from '../state/driver-resource';
import { useDriverForeground } from './use-driver-foreground';
export type { Resource } from '../state/driver-resource';

// Compatibility export used by Customer/shared navigation. Keep its behavior.
export function useForeground() {
  const [foreground, setForeground] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => listener.remove();
  }, []);
  return foreground;
}
export function useResource<T>(resource: DriverResource<T>) {
  const state = useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot);
  return { ...state, refresh: resource.refresh, replace: resource.replace };
}
export function useFocusedResource<T>(resource: DriverResource<T>, enabled = true) {
  const foreground = useDriverForeground();
  useFocusEffect(useCallback(() => { if (enabled && foreground) return resource.retain(); }, [enabled, foreground, resource]));
  return useResource(resource);
}
