import {createContext,useContext,useEffect,useState,useSyncExternalStore,type PropsWithChildren} from 'react';
import * as SecureStore from 'expo-secure-store';
import {Platform} from 'react-native';
import {discover} from '../backend/discovery';
import {BackendHttp} from '../backend/http';
import {UserApi,CustomerTripApi,PreviewApi} from '../backend/clients';
import {UserSession} from '../backend/user-session';
import {TripEvents} from '../backend/trip-events';
import {Screen,Notice,Busy} from '../driver/components/ui';
export interface CustomerRuntime{base:string;user:UserApi;session:UserSession;trips:CustomerTripApi;routes:PreviewApi;events:TripEvents}
const Context=createContext<CustomerRuntime|null>(null);
export function CustomerProvider({children}:PropsWithChildren){
  const [runtime,setRuntime]=useState<CustomerRuntime|null>(null),[error,setError]=useState<unknown>(null);
  useEffect(()=>{const control=new AbortController();void(async()=>{
    const base=await discover({development:__DEV__,platform:Platform.OS==='android'?'android':'web',explicit:process.env.EXPO_PUBLIC_BACKEND_ORIGIN,signal:control.signal});if(control.signal.aborted)return;
    const http=new BackendHttp(base),user=new UserApi(http);let memory:string|null=null;const key='chande.customer.refresh';
    const storage={read:async()=>{const raw=Platform.OS==='web'?memory:await SecureStore.getItemAsync(key);if(!raw)return null;try{const d=JSON.parse(raw);return d.base===base?d.token:null}catch{return null}},write:async(token:string|null)=>{const raw=token?JSON.stringify({base,token}):null;if(Platform.OS==='web')memory=raw;else if(raw)await SecureStore.setItemAsync(key,raw);else await SecureStore.deleteItemAsync(key)}};
    const session=new UserSession(user,storage);setRuntime({base,user,session,trips:new CustomerTripApi(http),routes:new PreviewApi(http),events:new TripEvents(base,()=>session.token())});void session.restore();
  })().catch(e=>{if(!control.signal.aborted)setError(e)});return()=>control.abort()},[]);
  if(!runtime)return <Screen title="Kết nối Customer"><Busy visible={!error}/><Notice>{error instanceof Error?error.message:'Đang nhận Gateway local…'}</Notice></Screen>;
  return <Context.Provider value={runtime}><CustomerEvents/>{children}</Context.Provider>;
}
function CustomerEvents(){const runtime=useCustomer(),state=useCustomerSession(),actorId=state.session?.profile.id;useEffect(()=>{if(actorId)runtime.events.start();return()=>runtime.events.stop()},[runtime,actorId]);return null}
export function useCustomer(){const value=useContext(Context);if(!value)throw new Error('CustomerProvider required');return value}
export function useCustomerSession(){const {session}=useCustomer();return useSyncExternalStore(session.subscribe,session.getSnapshot,session.getSnapshot)}
