import { createContext, useContext, useEffect, useState, useSyncExternalStore, type PropsWithChildren } from 'react';
import { Screen, Notice } from '../components/ui';
import { errorText } from '../http/errors';
import { createDriverRuntime, type DriverRuntime } from './runtime';

const Context = createContext<DriverRuntime | null>(null);
export function DriverProvider({ children }: PropsWithChildren) {
  const [initial] = useState(() => {
    try { return { runtime: createDriverRuntime(), error: null }; }
    catch (error) { return { runtime: null, error }; }
  });
  useEffect(() => {
    if (initial.runtime) void initial.runtime.session.restore();
  }, [initial]);
  if (!initial.runtime) return (
    <Screen title="Cấu hình Driver">
      <Notice>{errorText(initial.error)}</Notice>
      <Notice>Sao chép driver.env.example thành .env.local trong app, điền URL và khởi động lại Expo.</Notice>
    </Screen>
  );
  return <Context.Provider value={initial.runtime}><SessionEffects />{children}</Context.Provider>;
}
function SessionEffects() {
  const { commands, trip, realtime } = useDriverRuntime();
  const { session } = useDriverSession();
  const driverId = session?.driver.driverId ?? null;
  useEffect(() => {
    trip.clear();
    void commands.initialize(driverId);
    // No-op until a confirmed realtime adapter is supplied; never marks presence online.
    if (driverId) void realtime.connect().catch(() => {});
    return () => realtime.disconnect();
  }, [commands, driverId, realtime, trip]);
  return null;
}
export function useDriverRuntime() {
  const runtime = useContext(Context);
  if (!runtime) throw new Error('DriverProvider required');
  return runtime;
}
export function useDriverSession() {
  const { session } = useDriverRuntime();
  return useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
}
export function useTripCommands() {
  const { commands } = useDriverRuntime();
  const state = useSyncExternalStore(commands.subscribe, commands.getSnapshot, commands.getSnapshot);
  return { ...state, manager: commands };
}
