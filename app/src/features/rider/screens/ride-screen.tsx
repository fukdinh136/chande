import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import {
  AppHeader, Banner, Icon, IconButton, Inset, PrimaryButton, PulseDot, SectionHeader, SheetHandle, TextButton, Txt, WaypointCard,
  colors, radius, shadows, space,
} from '@/design';
import { RideMap } from '../../map/ride-map';
import type { RideMapHandle } from '../../map/types';
import { toLngLat, type LngLat } from '../../navigation/geo';
import { CancelSheet } from '../components/cancel-sheet';
import { ProfileAvatar } from '../components/rider-screen';
import { SavedPlaces } from '../components/saved-places';
import { TierList } from '../components/tier-list';
import { FinishedPanel, STATUS_COPY, TripPanel } from '../components/trip-panel';
import { RiderError, errorText } from '../errors';
import { formatCountdown, formatDistance, formatDuration, formatVnd } from '../format';
import { currentPosition, describePoint, toPlace, useFocusPolling, useNow } from '../hooks';
import type { Quote } from '../models';
import { useRider } from '../provider';
import { useStore } from '../store';
import { vehicleTier } from '../vehicles';

/** Màn hình đặt xe theo thiết kế Stitch; khi có chuyến thì chuyển sang theo dõi chuyến, kết thúc thì hiện hoá đơn. */
export function RideScreen() {
  const { booking: bookingStore, trip: tripStore, realtime, routes, config, geocoder } = useRider();
  const booking = useStore(bookingStore);
  const tripState = useStore(tripStore);
  const realtimeStatus = useStore(realtime);
  const window = useWindowDimensions();
  const map = useRef<RideMapHandle>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<unknown>(null);
  // Tuyến của chuyến đang xem; geometry null khi không tìm được để không gọi lại mỗi lần polling.
  const [tripRoute, setTripRoute] = useState<{ tripId: string; geometry: LngLat[] | null } | null>(null);

  const active = tripState.trip;
  const finished = tripState.finished;
  const shown = active ?? finished;
  const quote = bookingStore.selectedQuote();

  const locate = useCallback(async () => {
    setLocating(true);
    setLocationError(null);
    try {
      const point = await currentPosition();
      bookingStore.setPickup(toPlace(point, await describePoint(point, geocoder)), true);
      map.current?.centerOn(point);
    } catch (error) {
      setLocationError(error);
    } finally {
      setLocating(false);
    }
  }, [bookingStore, geocoder]);

  useEffect(() => {
    if (!bookingStore.getSnapshot().pickup) void locate();
  }, [bookingStore, locate]);

  // Khi WebSocket sống chỉ cần đọc lại thưa; mất kết nối thì polling dày hơn.
  const pollMs = realtimeStatus === 'live' ? 30000 : config.pollIntervalMs;
  const poll = useCallback(() => { void tripStore.refresh(); }, [tripStore]);
  useFocusPolling(poll, active ? pollMs : null);

  const shownId = shown?.tripId ?? null;
  useEffect(() => {
    if (!shown || !routes || tripRoute?.tripId === shown.tripId) return;
    let cancelled = false;
    routes.route({ origin: toLngLat(shown.pickup), destination: toLngLat(shown.destination), vehicleType: shown.vehicleType })
      .then((planned) => { if (!cancelled) setTripRoute({ tripId: shown.tripId, geometry: planned.geometry }); })
      .catch(() => { if (!cancelled) setTripRoute({ tripId: shown.tripId, geometry: null }); });
    return () => { cancelled = true; };
  }, [shown, routes, tripRoute]);

  const pickup = shown?.pickup ?? booking.pickup;
  const destination = shown?.destination ?? booking.destination;
  const route = shown ? (tripRoute?.tripId === shown.tripId ? tripRoute.geometry : null) : booking.route?.geometry ?? null;
  const summary = shown ? shown.route : booking.route ? { distanceMeters: booking.route.distance, durationSeconds: booking.route.duration } : quote?.route ?? null;
  const fitKey = [shownId, pickup?.lat, pickup?.lng, destination?.lat, destination?.lng, route?.length].join('|');
  const mapHeight = Math.round(Math.min(360, Math.max(240, window.height * 0.36)));

  const confirm = async () => {
    try {
      const trip = await bookingStore.confirm();
      if (trip) tripStore.adopt(trip);
    } catch (error) {
      if (error instanceof RiderError && error.code === 'ACTIVE_TRIP_EXISTS') void tripStore.refresh();
    }
  };

  const title = active ? 'Theo dõi chuyến' : finished ? STATUS_COPY[finished.status].badge : 'Đặt chuyến';
  let content: ReactNode;
  let footer: ReactNode = null;
  if (active) {
    content = <TripPanel trip={active} realtime={realtimeStatus} pollSeconds={Math.round(pollMs / 1000)} error={tripState.error} onCancel={() => setCancelOpen(true)} />;
  } else if (finished) {
    content = <FinishedPanel trip={finished} onDone={() => tripStore.dismissFinished()} />;
  } else {
    content = (
      <>
        <WaypointCard
          pickup={{
            label: 'Điểm đón', title: booking.pickup?.address ?? null,
            placeholder: locating ? 'Đang xác định vị trí…' : 'Chọn điểm đón',
            onPress: () => router.push({ pathname: '/place', params: { target: 'pickup' } }),
            trailing: <Icon name="edit_location" size={18} color={colors.outline} />,
          }}
          destination={{
            label: 'Điểm đến', title: booking.destination?.address ?? null, placeholder: 'Bạn muốn đi đâu?',
            onPress: () => router.push({ pathname: '/place', params: { target: 'destination' } }),
            trailing: booking.destination
              ? <IconButton icon="close" label="Xoá điểm đến" variant="tonal" size={28} onPress={() => bookingStore.clearDestination()} />
              : <View style={styles.addBadge}><Icon name="add" size={14} color={colors.onSurfaceVariant} /></View>,
          }}
        />
        {locationError ? <Banner tone="warning" message={errorText(locationError)} action={<TextButton label="Thử lại" onPress={() => { void locate(); }} />} /> : null}
        {booking.destination ? (
          <>
            <SectionHeader title="Chọn loại xe" action={<Txt variant="label-sm" color={colors.primary}>Giá chốt khi đặt</Txt>} />
            <TierList vehicleTypes={config.vehicleTypes} quotes={booking.quotes} selected={booking.selected} onSelect={(type) => bookingStore.select(type)} />
            <Inset style={styles.payment}>
              <View style={styles.paymentIcon}><Icon name="payments" size={18} color={colors.primary} /></View>
              <View style={styles.flex}>
                <Txt variant="label-md">Tiền mặt</Txt>
                <Txt variant="body-sm" color={colors.onSurfaceVariant}>Thanh toán cho tài xế khi kết thúc chuyến</Txt>
              </View>
            </Inset>
            {booking.createError ? <Banner tone="error" message={errorText(booking.createError)} /> : null}
          </>
        ) : (
          <SavedPlaces title="Đi đâu hôm nay?" onPick={(address) => bookingStore.setDestination({ lat: address.lat, lng: address.lng, address: address.addressText })} />
        )}
      </>
    );
    if (booking.destination) {
      footer = (
        <BookingFooter quote={quote} vehicleType={booking.selected} creating={booking.creating}
          onConfirm={() => { void confirm(); }} onRefresh={() => { void bookingStore.refresh(); }} />
      );
    }
  }

  return (
    <View style={styles.root}>
      <AppHeader title={title} right={<ProfileAvatar />} />
      <View style={{ height: mapHeight }}>
        <RideMap ref={map} style={StyleSheet.absoluteFill} pickup={pickup} destination={destination} route={route} fitKey={fitKey}
          padding={{ top: 64, right: 72, bottom: 48, left: 40 }} />
        {summary ? (
          <View style={styles.metric} pointerEvents="none">
            <PulseDot color={colors.tertiary} active={!!active} size={8} />
            <Txt variant="label-md" tabular>
              <Txt variant="label-md" weight="bold" color={colors.primary}>{formatDistance(summary.distanceMeters)}</Txt>
              {` • ${formatDuration(summary.durationSeconds)}`}
            </Txt>
          </View>
        ) : null}
        <View style={styles.floating}>
          <IconButton icon="near_me" label="Xem toàn tuyến" size={40} onPress={() => map.current?.fit()} />
          {!shown ? <IconButton icon="my_location" label="Đón tại vị trí hiện tại" size={40} disabled={locating} onPress={() => { void locate(); }} /> : null}
        </View>
      </View>
      <View style={styles.sheet}>
        <SheetHandle />
        <ScrollView style={styles.flex} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">{content}</ScrollView>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </View>
      {active ? (
        <CancelSheet visible={cancelOpen} busy={tripState.cancelling} error={tripState.cancelError} onClose={() => setCancelOpen(false)}
          onConfirm={(reason) => { void tripStore.cancel(reason).then((done) => { if (done) setCancelOpen(false); }); }} />
      ) : null}
    </View>
  );
}

/** CTA đặt xe kèm giá và dòng "giá được giữ" đếm ngược theo expiresAt của báo giá (Trip giữ 5 phút). */
function BookingFooter({ quote, vehicleType, creating, onConfirm, onRefresh }: {
  quote: Quote | null; vehicleType: string | null; creating: boolean; onConfirm: () => void; onRefresh: () => void;
}) {
  const now = useNow(!!quote);
  const expired = !!quote && Date.parse(quote.expiresAt) <= now;
  const tier = vehicleType ? vehicleTier(vehicleType) : null;
  return (
    <>
      {expired ? (
        <PrimaryButton label="Cập nhật giá mới" icon="refresh" loading={creating} onPress={onRefresh} />
      ) : (
        <PrimaryButton label={tier ? `Đặt ${tier.title}` : 'Chọn loại xe'} icon="bolt" trailing={quote ? formatVnd(quote.fare.amount) : undefined}
          loading={creating} disabled={!quote} onPress={onConfirm} />
      )}
      {quote ? (
        <View style={styles.lock}>
          <PulseDot color={expired ? colors.error : colors.tertiary} active={false} size={6} />
          <Txt variant="label-sm" color={colors.onSurfaceVariant}>
            {expired ? 'Báo giá đã hết hạn' : `Giá được giữ thêm ${formatCountdown(Date.parse(quote.expiresAt) - now)}`}
          </Txt>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  metric: {
    position: 'absolute', top: space.gutter, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: space.xs,
    paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.full, backgroundColor: 'rgba(255, 255, 255, 0.95)', boxShadow: shadows.raised,
  },
  floating: { position: 'absolute', right: space.gutter, bottom: space.lg + space.gutter, gap: space.xs },
  sheet: {
    flex: 1, marginTop: -space.gutter, backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingTop: space.md, boxShadow: shadows.sheet,
  },
  sheetContent: { paddingHorizontal: space.gutter, paddingTop: space.md, paddingBottom: space.lg, gap: space.md },
  footer: { paddingHorizontal: space.gutter, paddingTop: space.sm, paddingBottom: space.sm, gap: space.xs },
  lock: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs },
  addBadge: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  payment: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  paymentIcon: { width: 32, height: 32, borderRadius: radius.sm, backgroundColor: colors.surfaceContainerLowest, alignItems: 'center', justifyContent: 'center', boxShadow: shadows.card },
});
