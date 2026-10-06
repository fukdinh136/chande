import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AppHeader, Banner, Card, Icon, Loading, PrimaryButton, SecondaryButton, TextButton, Txt, colors, radius, shadows, space,
} from '@/design';
import { RideMap } from '../../map/ride-map';
import { toLatLng, toLngLat, type LngLat } from '../../navigation/geo';
import { capitalize, maneuverPhrase, upcomingPhrase } from '../../navigation/instructions';
import type { PlannedRoute } from '../../navigation/model';
import { RouteTracker, type GuidanceState } from '../../navigation/progress';
import { createRouteProvider, routingErrorText } from '../../navigation/providers';
import { RoutingError } from '../../navigation/routes';
import { NativeNavigationSession, nativeNavigationAvailable, type NavigationSessionEvent, type NavigationTarget } from '../../navigation/session';
import type { Trip } from '../contracts/models';
import { ApiError, errorText } from '../http/errors';
import { useFocusedResource } from '../hooks/use-focused-resource';
import { useDriverRuntime } from '../state/driver-provider';

type Phase = 'preview' | 'native' | 'guidance' | 'arrived';

function targetOf(trip: Trip): NavigationTarget | null {
  if (trip.status === 'ASSIGNED') return { location: toLngLat(trip.pickup), label: 'điểm đón', vehicleType: trip.vehicleType };
  if (trip.status === 'IN_PROGRESS') return { location: toLngLat(trip.destination), label: 'điểm trả', vehicleType: trip.vehicleType };
  return null;
}
const kilometers = (meters: number) => (meters >= 1000 ? `${(meters / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(meters / 10) * 10} m`);
const minutes = (seconds: number) => `${Math.max(1, Math.round(seconds / 60))} phút`;
function describeError(error: unknown): string {
  if (error instanceof RoutingError) return routingErrorText(error);
  if (error instanceof ApiError) return errorText(error);
  if (error instanceof Error && error.message === 'LOCATION_DENIED') return 'Cần quyền vị trí để dẫn đường.';
  // Lỗi từ module native (ví dụ tuyến sai định dạng) có thông điệp tiếng Việt.
  if (error instanceof Error && error.message) return error.message;
  return 'Không mở được dẫn đường.';
}

/** Dẫn đường tới điểm đón (ASSIGNED) hoặc điểm trả (IN_PROGRESS) bằng MapLibre Navigation SDK; iOS/web dùng bản dự phòng. */
export function NavigationScreen() {
  const runtime = useDriverRuntime();
  const insets = useSafeAreaInsets();
  const resource = useFocusedResource(useCallback((signal: AbortSignal) => runtime.trip.active(signal), [runtime]), runtime.trip.enabled, null);
  const trip = resource.data ?? null;
  const target = trip ? targetOf(trip) : null;
  const targetKey = trip && target ? `${trip.tripId}:${trip.status}` : null;
  const provider = useMemo(() => createRouteProvider(async (signal) => {
    // Đi qua một request Driver để SessionManager làm mới token nếu cần (giống GPS).
    await runtime.driver.profile(signal);
    return runtime.session.getSnapshot().session?.accessToken ?? null;
  }), [runtime]);

  const [origin, setOrigin] = useState<LngLat | null>(null);
  const [route, setRoute] = useState<PlannedRoute | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [phase, setPhase] = useState<Phase>('preview');
  const [notice, setNotice] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<{ distance: number; duration: number } | null>(null);
  const [guidance, setGuidance] = useState<GuidanceState | null>(null);
  const [showAll, setShowAll] = useState(false);
  const session = useRef<NativeNavigationSession | null>(null);
  const targetRef = useRef(target);
  const routeRef = useRef(route);
  useEffect(() => { targetRef.current = target; routeRef.current = route; });

  const plan = useCallback(async () => {
    const goal = targetRef.current;
    if (!goal || !provider) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) throw new Error('LOCATION_DENIED');
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const start: LngLat = [position.coords.longitude, position.coords.latitude];
      setOrigin(start);
      setRoute(await provider.route({ origin: start, destination: goal.location, vehicleType: goal.vehicleType }));
      setPhase('preview');
    } catch (failure) {
      setError(failure);
    } finally {
      setLoading(false);
    }
  }, [provider]);

  useEffect(() => {
    if (targetKey) void plan();
  }, [targetKey, plan]);

  useEffect(() => () => session.current?.dispose(), []);

  const onEvent = useCallback((event: NavigationSessionEvent) => {
    switch (event.type) {
      case 'progress': setRemaining({ distance: event.distanceRemaining, duration: event.durationRemaining }); break;
      case 'rerouting': setNotice('Đang tính lại tuyến…'); break;
      case 'rerouted': setRoute(event.route); setNotice('Đã cập nhật tuyến mới.'); break;
      case 'rerouteFailed': setNotice(`Chưa tính lại được tuyến: ${routingErrorText(event.error)}`); break;
      case 'arrival': setPhase('arrived'); break;
      case 'ended':
        setPhase(event.reason === 'arrived' ? 'arrived' : 'preview');
        if (event.reason === 'error') setNotice(event.message ?? 'Màn hình dẫn đường gặp lỗi.');
        break;
      default: break;
    }
  }, []);

  const startNative = async (simulate: boolean) => {
    if (!route || !origin || !target || !provider) return;
    session.current?.dispose();
    const next = new NativeNavigationSession(provider, target, onEvent);
    session.current = next;
    setError(null);
    setNotice(null);
    try {
      await next.start(route, origin, simulate);
      setPhase('native');
    } catch (failure) {
      setError(failure);
    }
  };

  // Dự phòng khi không có SDK native: theo dõi GPS, tự xác định bước hiện tại và tính lại tuyến khi lệch.
  useEffect(() => {
    const goal = targetRef.current;
    const initialRoute = routeRef.current;
    if (phase !== 'guidance' || !goal || !initialRoute || !provider) return;
    let tracker = new RouteTracker(initialRoute);
    let disposed = false, rerouting = false, lastReroute = 0;
    let subscription: Location.LocationSubscription | null = null;
    void Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 3 }, (position) => {
      if (disposed) return;
      const point: LngLat = [position.coords.longitude, position.coords.latitude];
      const state = tracker.update(point);
      setGuidance(state);
      if (state.arrived) { setPhase('arrived'); return; }
      if (state.offRoute && !rerouting && Date.now() - lastReroute > 15000) {
        rerouting = true;
        lastReroute = Date.now();
        setNotice('Đang tính lại tuyến…');
        provider.route({ origin: point, destination: goal.location, vehicleType: goal.vehicleType, reroute: true })
          .then((next) => {
            if (disposed) return;
            tracker = new RouteTracker(next);
            setRoute(next);
            setNotice('Đã cập nhật tuyến mới.');
          })
          .catch((failure: unknown) => { if (!disposed) setNotice(`Chưa tính lại được tuyến: ${routingErrorText(failure)}`); })
          .finally(() => { rerouting = false; });
      }
    }).then((value) => { if (disposed) value.remove(); else subscription = value; }).catch((failure: unknown) => setError(failure));
    return () => {
      disposed = true;
      subscription?.remove();
    };
  }, [phase, provider, targetKey]);

  const steps = route?.steps ?? [];
  const context = { destinationLabel: target?.label ?? 'điểm đến' };
  const current = guidance && phase === 'guidance' ? steps[guidance.stepIndex + 1] : null;
  const summaryDistance = remaining?.distance ?? guidance?.distanceRemaining ?? route?.distance ?? null;
  const summaryDuration = remaining?.duration ?? guidance?.durationRemaining ?? route?.duration ?? null;
  const address = trip ? (target?.label === 'điểm đón' ? trip.pickup.address : trip.destination.address) : null;

  return (
    <View style={styles.root}>
      <AppHeader title={target ? `Dẫn đường đến ${target.label}` : 'Dẫn đường'} overline="Chande tài xế" onBack={() => router.back()} />
      <View style={styles.flex}>
        <RideMap style={StyleSheet.absoluteFill} pickup={origin ? toLatLng(origin) : null} destination={target ? toLatLng(target.location) : null}
          route={route?.geometry ?? null} fitKey={`${targetKey}:${route?.geometry.length ?? 0}:${phase}`}
          showUserLocation={phase === 'guidance'} followUser={phase === 'guidance'} padding={{ top: 80, right: 48, bottom: 48, left: 48 }} />
        {current && guidance ? (
          <View style={[styles.instruction, { top: space.gutter }]}>
            <Icon name="directions" size={28} color={colors.onPrimary} />
            <View style={styles.flex}>
              <Txt variant="headline-sm" tabular color={colors.onPrimary}>{kilometers(guidance.distanceToManeuver)}</Txt>
              <Txt variant="title-md" color={colors.onPrimary} numberOfLines={2}>{capitalize(upcomingPhrase(current, context))}</Txt>
            </View>
          </View>
        ) : null}
      </View>
      <View style={[styles.panel, { paddingBottom: Math.max(insets.bottom, space.gutter) }]}>
        {!runtime.trip.enabled ? <Banner tone="warning" message="Trip chưa được cấu hình nên không biết điểm cần đến." /> : null}
        {resource.loading && !trip ? <Loading label="Đang đọc chuyến hiện tại…" /> : null}
        {resource.checkedAt && !target ? (
          <Banner tone="info" message={trip?.status === 'DRIVER_ARRIVED'
            ? 'Bạn đã ở điểm đón. Bắt đầu chuyến để được dẫn đường tới điểm trả.'
            : 'Không có chuyến cần dẫn đường (chỉ dẫn đường khi đã nhận chuyến hoặc đang chở khách).'} />
        ) : null}
        {!provider ? <Banner tone="warning" message="Chưa cấu hình nguồn tuyến (EXPO_PUBLIC_ROUTING_MODE, EXPO_PUBLIC_OSRM_BASE_URL hoặc API Gateway)." /> : null}
        {error ? <Banner tone="error" message={describeError(error)} action={<TextButton label="Thử lại" onPress={() => { void plan(); }} />} /> : null}
        {notice ? <Banner tone="info" message={notice} /> : null}
        {phase === 'arrived' ? <Banner tone="success" title={`Đã đến ${target?.label ?? 'nơi'}`} message="Quay lại chuyến hiện tại để cập nhật trạng thái." /> : null}
        {target && route && summaryDistance !== null && summaryDuration !== null ? (
          <Card style={styles.summary}>
            <View style={styles.flex}>
              <Txt variant="label-sm" uppercase color={colors.primary}>{target.label}</Txt>
              <Txt variant="title-md" numberOfLines={1}>{address ?? 'Vị trí đã ghim'}</Txt>
            </View>
            <View style={styles.metrics}>
              <Txt variant="headline-sm" tabular color={colors.primary}>{minutes(summaryDuration)}</Txt>
              <Txt variant="body-sm" tabular color={colors.onSurfaceVariant}>{kilometers(summaryDistance)}</Txt>
            </View>
          </Card>
        ) : null}
        {loading ? <Loading label="Đang tìm đường…" /> : null}
        {route && phase === 'preview' ? (
          <ScrollView style={styles.steps} contentContainerStyle={styles.stepList}>
            {(showAll ? steps : steps.slice(0, 4)).map((step, index) => (
              <View key={`${index}-${step.maneuver.location.join(',')}`} style={styles.step}>
                <Txt variant="label-md" tabular color={colors.slateMuted} style={styles.stepIndex}>{index + 1}</Txt>
                <Txt variant="body-md" style={styles.flex}>{capitalize(maneuverPhrase(step, context))}</Txt>
                {step.distance > 0 ? <Txt variant="body-sm" tabular color={colors.slateMuted}>{kilometers(step.distance)}</Txt> : null}
              </View>
            ))}
            {steps.length > 4 ? <TextButton label={showAll ? 'Thu gọn' : `Xem tất cả ${steps.length} bước`} onPress={() => setShowAll(!showAll)} /> : null}
          </ScrollView>
        ) : null}
        {route && target && phase === 'preview' ? (
          nativeNavigationAvailable ? (
            <View style={styles.actions}>
              <PrimaryButton label="Bắt đầu dẫn đường" icon="navigation" onPress={() => { void startNative(false); }} />
              <SecondaryButton label="Chạy giả lập dọc tuyến" icon="alt_route" onPress={() => { void startNative(true); }} />
            </View>
          ) : (
            <View style={styles.actions}>
              <PrimaryButton label="Bắt đầu dẫn đường" icon="navigation" onPress={() => { setNotice(null); setPhase('guidance'); }} />
              <Txt variant="body-sm" color={colors.slateMuted}>
                Thiết bị này chưa có MapLibre Navigation SDK native (cần Android development build); đang dùng dẫn đường trên bản đồ.
              </Txt>
            </View>
          )
        ) : null}
        {phase === 'native' ? <SecondaryButton label="Kết thúc dẫn đường" icon="close" onPress={() => { void session.current?.stop(); }} /> : null}
        {phase === 'guidance' ? <SecondaryButton label="Kết thúc dẫn đường" icon="close" onPress={() => { setPhase('preview'); setGuidance(null); }} /> : null}
        {phase === 'arrived' ? <PrimaryButton label="Về chuyến hiện tại" icon="check" onPress={() => router.back()} /> : null}
        {route && phase === 'preview' ? <TextButton label="Tính lại tuyến từ vị trí hiện tại" onPress={() => { void plan(); }} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1, minWidth: 0 },
  instruction: {
    position: 'absolute', left: space.gutter, right: space.gutter, flexDirection: 'row', alignItems: 'center', gap: space.md,
    padding: space.md, borderRadius: radius.md, backgroundColor: colors.primary, boxShadow: shadows.float,
  },
  panel: {
    marginTop: -space.gutter, paddingHorizontal: space.gutter, paddingTop: space.lg, gap: space.sm, backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, boxShadow: shadows.sheet, maxHeight: '60%',
  },
  summary: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  metrics: { alignItems: 'flex-end' },
  steps: { maxHeight: 220 },
  stepList: { gap: space.xs },
  step: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 32 },
  stepIndex: { width: 20 },
  actions: { gap: space.sm },
});
