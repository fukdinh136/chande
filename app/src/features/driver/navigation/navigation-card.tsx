import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/components/themed-text';
import { useLocation } from '../../map/location-store';
import { RideMap } from '../../map/ride-map';
import { instruction as describeManeuver } from '../../navigation/instruction';
import { distance, duration, palette } from '../../ui/design';
import { useDriverRuntime } from '../state/driver-provider';
import { useDriverForeground } from '../hooks/use-driver-foreground';
import { Action, Card, Notice } from '../components/ui';
import type { Trip } from '../contracts/models';
import { DriverNavigationSession, navigationPhase, navigationScope } from './navigation-session';

export function DriverNavigationCard({ trip, verified }: { trip: Trip; verified: boolean }) {
  const runtime = useDriverRuntime(), foreground = useDriverForeground(), focused = useIsFocused();
  const manager = useMemo(() => new DriverNavigationSession(runtime), [runtime]);
  const state = useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getSnapshot);
  // Polling version/profile updates do not create a new route lifecycle.
  const plan = useMemo(() => ({ tripId: trip.tripId, status: trip.status, vehicleType: trip.vehicleType,
    pickup: { lat: trip.pickup.lat, lng: trip.pickup.lng }, destination: { lat: trip.destination.lat, lng: trip.destination.lng } }),
  [trip.tripId, trip.status, trip.vehicleType, trip.pickup.lat, trip.pickup.lng, trip.destination.lat, trip.destination.lng]);
  const phase = navigationPhase(plan), scope = navigationScope(plan);
  useEffect(() => {
    if (focused && foreground && verified && phase) manager.start(plan);
    return manager.stop;
  }, [manager, focused, foreground, verified, phase, plan]);
  const active = focused && foreground && verified && !!phase && state.scope === scope;
  const progress = active && state.stage === 'navigating' ? state.progress : null;
  const line = active ? state.line : undefined;
  const instruction = progress ? describeManeuver(progress.maneuver, progress.modifier, progress.street) : phase === 'dropoff' ? 'Tuyến đến điểm trả khách' : 'Tuyến đến điểm đón khách';
  if (!phase) return <>
    <Notice>{trip.status === 'DRIVER_ARRIVED' ? 'Đã đến điểm đón. Chờ khách và xác nhận bắt đầu.' : 'Không có phiên điều hướng cho trạng thái chuyến này.'}</Notice>
    <DriverTripMap trip={trip} fitKey={`${trip.tripId}:${trip.status}`} height={240} />
  </>;
  return <>
    <Card>
      <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
        <Ionicons name={progress?.modifier === 'left' ? 'arrow-back' : progress?.modifier === 'right' ? 'arrow-forward' : 'navigate'} size={32} color={palette.primary} />
        <View style={{ flex: 1 }}>
          <ThemedText type="smallBold">{instruction}</ThemedText>
          <Notice>{!active ? !verified ? 'Chưa xác nhận được trạng thái chuyến mới nhất. Hãy đọc lại chuyến.' : 'Điều hướng tạm dừng khi rời màn hình hoặc app vào background.' : state.message}</Notice>
          {progress && <Notice>{distance(progress.distanceToManeuverMeters)} đến chỉ dẫn tiếp theo</Notice>}
        </View>
      </View>
      {active && state.stage === 'preview' && <Notice>Preview không cung cấp chỉ dẫn turn-by-turn.</Notice>}
      {active && state.error && <Notice>{state.error}</Notice>}
      {progress ? <ThemedText>{duration(progress.remainingDurationSeconds)} · {distance(progress.remainingDistanceMeters)}</ThemedText>
        : active && state.distanceMeters !== null && state.durationSeconds !== null && <Notice>Tuyến tính từ Routing: {distance(state.distanceMeters)} · {duration(state.durationSeconds)}; chưa phải tiến độ di chuyển.</Notice>}
      {progress && progress.remainingDistanceMeters < 40 && <Notice>Đã gần điểm đến. Xác nhận trạng thái chuyến bằng nút bên dưới.</Notice>}
      {active && ['preview', 'navigating', 'error'].includes(state.stage) && <Action label={state.stage === 'error' ? 'Thử lấy tuyến lại' : 'Lấy lại tuyến'} variant="secondary" onPress={manager.retry} />}
    </Card>
    <DriverTripMap trip={trip} line={line} fitKey={`${trip.tripId}:${phase}`} height={280} />
  </>;
}
function DriverTripMap({ trip, line, fitKey, height }: { trip: Trip; line?: [number, number][]; fitKey: string; height: number }) {
  const position = useLocation();
  return <RideMap pickup={trip.pickup} destination={trip.destination} position={position} line={line} fitKey={fitKey} height={height} />;
}
