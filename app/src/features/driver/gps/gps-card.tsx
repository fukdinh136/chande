import { useCallback, useState } from 'react';
import { Notice } from '../components/ui';
import { useDriverRuntime, useDriverSession } from '../state/driver-provider';
import { useDriverGps } from './use-driver-gps';
import type { DesiredStatus } from '../contracts/models';
import {View,Switch} from 'react-native';
import {palette} from '../../ui/design';
export function GpsCard({ desiredStatus, selectedVehicleId,activeTrip=false }: { desiredStatus?: DesiredStatus; selectedVehicleId?: string | null;activeTrip?:boolean }) {
  const runtime = useDriverRuntime();
  const state = useDriverSession();
  const driverId = state.session?.driver.driverId;
  const [requested, setRequested] = useState(false);
  const allowed = !!state.session && ((desiredStatus === 'ONLINE' && !!selectedVehicleId)||activeTrip);
  const token = useCallback(async (signal: AbortSignal) => {
    // Reuse SessionManager's existing serialized refresh through a protected Driver request.
    await runtime.driver.profile(signal);
    const session = runtime.session.getSnapshot().session;
    if (!session || session.driver.driverId !== driverId) throw new Error('UNAUTHENTICATED');
    return session.accessToken;
  }, [runtime, driverId]);
  const gps = useDriverGps(requested && allowed, token,runtime.config.gatewayBase);
  return <View style={{paddingHorizontal:20,paddingVertical:8,backgroundColor:palette.card,borderBottomWidth:1,borderColor:palette.line}}><View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}><Notice>{gps.lastAcceptedAt?'Vị trí đang cập nhật':'Bật GPS để nhận chuyến gần bạn'}</Notice><Switch accessibilityLabel="Bật GPS" value={requested} disabled={!requested&&!allowed} onValueChange={setRequested} trackColor={{true:palette.primary,false:'#cad8d4'}}/></View>
    {!allowed && <Notice>Cần đăng nhập, chọn xe và bật nhận cuốc để gửi vị trí.</Notice>}
    <Notice>{gps.message}</Notice>
  </View>;
}
