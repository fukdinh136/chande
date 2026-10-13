import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { useDriverRuntime, useDriverSession } from './driver-provider';
import { useResource } from '../hooks/use-focused-resource';
import { useDriverForeground } from '../hooks/use-driver-foreground';
import { DriverResourceStore } from './resource-store';

function useSessionResources() {
  const runtime = useDriverRuntime();
  const { session } = useDriverSession();
  const driverId = session?.driver.driverId ?? null;
  const [store] = useState(() => new DriverResourceStore(runtime, runtime.session.getOwnerEpoch()));
  const foreground = useDriverForeground();
  const intent = useResource(store.intent), active = useResource(store.active);
  useEffect(() => {
    runtime.trip.clear();
    void runtime.commands.initialize(driverId);
    // Immediately invalidate reads on owner loss, before React unmounts children.
    const unsubscribe = runtime.session.subscribe(() => { if (!runtime.session.getSnapshot().usable || runtime.session.getSnapshot().session?.driver.driverId !== driverId) store.clear(); });
    return () => { unsubscribe(); store.clear(); runtime.trip.clear(); void runtime.commands.initialize(null); };
  }, [runtime, driverId, store]);
  useEffect(() => {
    if (!foreground) return;
    const releaseIntent = store.intent.retain(10000);
    const releaseActive = runtime.trip.enabled ? store.active.retain(runtime.config.pollIntervalMs) : () => {};
    return () => { releaseIntent(); releaseActive(); };
  }, [runtime, store, foreground]);
  useEffect(() => {
    if (foreground) void runtime.realtime.connect();
    return () => runtime.realtime.disconnect();
  }, [runtime, foreground]);
  useEffect(() => runtime.realtime.subscribe(notice => {
    if (notice.kind === 'reconnected' || notice.kind === 'trip-invalidated') store.invalidateTrips();
    if (notice.kind === 'reconnected') { store.profile.refresh(); store.vehicles.refresh(); }
    if (notice.kind === 'offer-invalidated') store.intent.refresh();
  }), [runtime, store]);
  useEffect(() => {
    let busy = runtime.commands.getSnapshot().busy;
    return runtime.commands.subscribe(() => {
      const next = runtime.commands.getSnapshot().busy;
      if (busy && !next) store.invalidateTrips();
      busy = next;
    });
  }, [runtime, store]);
  return { intent, active, store };
}
const Context = createContext<ReturnType<typeof useSessionResources> | null>(null);
export function DriverSessionResources({ children }: PropsWithChildren) {
  return <Context.Provider value={useSessionResources()}>{children}</Context.Provider>;
}
export function useDriverResources() {
  const value = useContext(Context);
  if (!value) throw new Error('DriverSessionResources required');
  return value;
}
