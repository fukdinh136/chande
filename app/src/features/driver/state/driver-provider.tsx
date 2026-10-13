import { createContext, useContext, useEffect, useState, useSyncExternalStore, type PropsWithChildren } from 'react';
import { Screen, Notice, Busy, Action, ErrorNotice } from '../components/ui';
import {ConnectionSettings} from '../../backend/connection';
import { connectDriverRuntime, type DriverRuntime } from './runtime';
import {Redirect} from 'expo-router';
import {appRole} from '../../backend/app-role';
import {driverHttpMode} from '../http/config';

function usesGatewaySettings() {
  try { return driverHttpMode() === 'gateway'; } catch { return false; }
}

const Context = createContext<DriverRuntime | null>(null);
export function DriverProvider({ children }: PropsWithChildren) {
  if(appRole()==='customer')return <Redirect href="/customer"/>;
  return <ConnectedDriver>{children}</ConnectedDriver>;
}
function ConnectedDriver({children}:PropsWithChildren){
  const [attempt,setAttempt] = useState(0);
  const [initial,setInitial] = useState<{runtime:DriverRuntime|null;error:unknown;connecting:boolean}>({runtime:null,error:null,connecting:true});
  useEffect(() => {
    const control = new AbortController();
    let connected: DriverRuntime | null = null;
    void connectDriverRuntime(control.signal).then(runtime=>{if(!control.signal.aborted){connected=runtime;setInitial({runtime,error:null,connecting:false});void runtime.session.restore();}else runtime.dispose();}).catch(error=>{if(!control.signal.aborted)setInitial({runtime:null,error,connecting:false});});
    return ()=>{control.abort();connected?.dispose();};
  }, [attempt]);
  if (initial.connecting) return <Screen title="Kết nối backend"><Busy visible/><Notice>Đang đọc cấu hình kết nối Driver…</Notice></Screen>;
  if (!initial.runtime) return (
    <Screen title="Cấu hình Driver">
      <ErrorNotice error={initial.error}/>
      <Notice>Kiểm tra driver.env.example và các biến EXPO_PUBLIC_DRIVER_*. Sau khi sửa env, khởi động lại Expo để nạp cấu hình mới.</Notice>
      {usesGatewaySettings() && <ConnectionSettings/>}
      <Action label="Thử kết nối lại" onPress={()=>{setInitial({runtime:null,error:null,connecting:true});setAttempt(value=>value+1)}}/>
    </Screen>
  );
  return <Context.Provider value={initial.runtime}>{children}</Context.Provider>;
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
