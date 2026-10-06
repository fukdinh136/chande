import AppTabs from '@/components/app-tabs';
import { Redirect, Slot ,router,usePathname} from 'expo-router';
import { useDriverSession,useDriverRuntime } from '../state/driver-provider';
import { Busy, Screen } from './ui';
import {View} from 'react-native';
import {useCallback} from 'react';
import {useFocusedResource} from '../hooks/use-focused-resource';
import {GpsCard} from '../gps/gps-card';


import {OffersProvider} from '../state/offers-provider';

export function SessionGate() {
  const state = useDriverSession();
  if (state.restoring) return <Screen title="Khôi phục phiên"><Busy visible /></Screen>;
  if (!state.session) return <Redirect href="/driver/login" />;
  return <OffersProvider key={state.session.driver.driverId}><Authenticated/></OffersProvider>;
}
function Authenticated(){
  const runtime=useDriverRuntime();
  const pathname=usePathname();
  const intent=useFocusedResource(useCallback((signal:AbortSignal)=>runtime.driver.availability(signal),[runtime]),true,10000);
  const active=useFocusedResource(useCallback((signal:AbortSignal)=>runtime.trip.active(signal),[runtime]),runtime.trip.enabled,10000);
  return <View style={{flex:1}}><GpsCard desiredStatus={intent.error?undefined:intent.data?.desiredStatus} selectedVehicleId={intent.data?.selectedVehicleId} activeTrip={!active.error&&!!active.data}/><View style={{flex:1}}><Slot/></View><AppTabs driver value={pathname.includes('history')?'history':pathname.includes('profile')||pathname.includes('vehicles')?'profile':'home'} items={[{key:'home',label:'Nhận chuyến',icon:'navigate-outline'},{key:'history',label:'Lịch sử',icon:'receipt-outline'},{key:'profile',label:'Hồ sơ',icon:'person-outline'}]} onChange={value=>router.replace(value==='home'?'/driver':value==='history'?'/driver/history':'/driver/profile')}/></View>;
}
