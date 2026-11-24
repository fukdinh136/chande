import { Redirect, Slot } from 'expo-router';
import { DriverTabs } from './driver-tabs';
import { useDriverRuntime, useDriverSession } from '../state/driver-provider';
import { Busy, Screen } from './ui';
import { View } from 'react-native';
import { GpsCard } from '../gps/gps-card';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DriverSessionResources, useDriverResources } from '../state/session-resources';
import { DriverShellContext } from './shell-context';
import { useTheme } from '@/hooks/use-theme';
import { OffersProvider } from '../state/offers-provider';
import { SessionNotice, SessionRecoveryScreen } from './session-notice';

export function SessionGate() {
  const state = useDriverSession();
  const runtime = useDriverRuntime();
  if (state.restoring) return <Screen title="Khôi phục phiên"><Busy visible /></Screen>;
  if (!state.usable && !['signed-out', 'reauth-required'].includes(state.phase)) return <SessionRecoveryScreen/>;
  if (!state.session) return <Redirect href="/driver/login" />;
  if (!state.usable) return <SessionRecoveryScreen/>;
  return (
    <DriverSessionResources key={`${state.session.driver.driverId}:${runtime.session.getOwnerEpoch()}:${runtime.session.getResourceEpoch()}`}>
      <OffersProvider><Authenticated /></OffersProvider>
    </DriverSessionResources>
  );
}
function Authenticated() {
  const { intent, active } = useDriverResources();
  const theme = useTheme();
  return (
    <DriverShellContext.Provider value>
      <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: theme.background }}>
        <View style={{paddingHorizontal:20}}><SessionNotice/></View>
        <GpsCard desiredStatus={intent.data?.desiredStatus} selectedVehicleId={intent.data?.selectedVehicleId}
          activeTrip={!!active.data && ['ASSIGNED', 'DRIVER_ARRIVED', 'IN_PROGRESS'].includes(active.data.status)}
          statusUncertain={!!intent.error || !!active.error} />
        <View style={{ flex: 1 }}><Slot /></View>
        <SafeAreaView edges={['bottom']} style={{backgroundColor:theme.backgroundElement}}>
          <DriverTabs />
        </SafeAreaView>
      </SafeAreaView>
    </DriverShellContext.Provider>
  );
}
