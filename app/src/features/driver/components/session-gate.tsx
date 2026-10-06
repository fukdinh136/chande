import { Redirect, Slot } from 'expo-router';
import { useDriverSession,useDriverRuntime } from '../state/driver-provider';
import { Busy, Screen } from './ui';
import {View} from 'react-native';
import {useCallback} from 'react';
import {useFocusedResource} from '../hooks/use-focused-resource';
import {GpsCard} from '../gps/gps-card';

export function SessionGate() {
  const state = useDriverSession();
  if (state.restoring) return <Screen title="Khôi phục phiên"><Busy visible /></Screen>;
  if (!state.session) return <Redirect href="/driver/login" />;
  return <Authenticated key={state.session.driver.driverId}/>;
}
function Authenticated(){
  const runtime=useDriverRuntime();
  const intent=useFocusedResource(useCallback((signal:AbortSignal)=>runtime.driver.availability(signal),[runtime]),true,10000);
  return <View style={{flex:1}}><GpsCard desiredStatus={intent.error?undefined:intent.data?.desiredStatus} selectedVehicleId={intent.data?.selectedVehicleId}/><View style={{flex:1}}><Slot/></View></View>;
}
