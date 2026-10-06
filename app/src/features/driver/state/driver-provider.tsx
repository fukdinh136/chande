import { createContext, useContext, useEffect, useState, useSyncExternalStore, type PropsWithChildren } from 'react';
import { Screen, Notice, Busy } from '../components/ui';
import {ConnectionSettings} from '../../backend/connection';
import { connectDriverRuntime, type DriverRuntime } from './runtime';
import {Redirect} from 'expo-router';
import {appRole} from '../../backend/app-role';
import {useForeground} from '../hooks/use-focused-resource';

const Context = createContext<DriverRuntime | null>(null);
export function DriverProvider({ children }: PropsWithChildren) {
  if(appRole()==='customer')return <Redirect href="/customer"/>;
  return <ConnectedDriver>{children}</ConnectedDriver>;
}
function ConnectedDriver({children}:PropsWithChildren){
  const [initial,setInitial] = useState<{runtime:DriverRuntime|null;error:unknown;connecting:boolean}>({runtime:null,error:null,connecting:true});
  useEffect(() => {
    const control = new AbortController();
    void connectDriverRuntime(control.signal).then(runtime=>{if(!control.signal.aborted){setInitial({runtime,error:null,connecting:false});void runtime.session.restore();}}).catch(error=>{if(!control.signal.aborted)setInitial({runtime:null,error,connecting:false});});
    return ()=>control.abort();
  }, []);
  if (initial.connecting) return <Screen title="Kết nối backend"><Busy visible/><Notice>Đang kiểm tra Gateway local đã triển khai…</Notice></Screen>;
  if (!initial.runtime) return (
    <Screen title="Cấu hình Driver">
      <Notice>Chưa kết nối được máy chủ. Kiểm tra địa chỉ và kết nối mạng.</Notice><ConnectionSettings/>
      <Notice>Bật backend local hoặc đặt EXPO_PUBLIC_BACKEND_ORIGIN rồi khởi động lại Expo. Android emulator tự kiểm tra 10.0.2.2; máy thật cần adb reverse hoặc URL đã cấu hình.</Notice>
    </Screen>
  );
  return <Context.Provider value={initial.runtime}><SessionEffects />{children}</Context.Provider>;
}
function SessionEffects() {
  const { commands, trip, realtime } = useDriverRuntime();
  const { session } = useDriverSession();
  const driverId = session?.driver.driverId ?? null;
  const foreground=useForeground();
  useEffect(() => {
    trip.clear();
    void commands.initialize(driverId);
  }, [commands, driverId, trip]);
  useEffect(()=>{
    // Realtime invalidates REST data; availability remains owned by Driver.
    if (driverId&&foreground) void realtime.connect().catch(() => {});
    return () => realtime.disconnect();
  },[driverId,foreground,realtime]);
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
