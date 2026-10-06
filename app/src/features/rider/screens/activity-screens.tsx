import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import {
  AppHeader, Banner, Card, EmptyState, Loading, PrimaryButton, SecondaryButton, StatusBadge, Txt, colors, radius, space,
} from '@/design';
import { ProfileAvatar, RiderScreen } from '../components/rider-screen';
import { DriverCard, FareCard, STATUS_COPY, TripWaypoints } from '../components/trip-panel';
import { RiderError, errorText } from '../errors';
import { formatDateTime, formatVnd } from '../format';
import { isTerminal, type RiderTrip, type TripDetail, type TripStatus } from '../models';
import { useRider } from '../provider';
import { vehicleTier } from '../vehicles';

type Filter = 'ALL' | Extract<TripStatus, 'COMPLETED' | 'CANCELLED'>;
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'ALL', label: 'Tất cả' }, { value: 'COMPLETED', label: 'Hoàn thành' }, { value: 'CANCELLED', label: 'Đã huỷ' },
];

function HistoryCard({ trip }: { trip: RiderTrip }) {
  const copy = STATUS_COPY[trip.status];
  return (
    <Card onPress={() => router.push({ pathname: '/trip/[id]', params: { id: trip.tripId } })} accessibilityLabel={`Chuyến ${formatDateTime(trip.timestamps.requestedAt)}`} style={styles.card}>
      <View style={styles.cardTop}>
        <Txt variant="label-md" color={colors.onSurfaceVariant}>{formatDateTime(trip.timestamps.requestedAt)}</Txt>
        <StatusBadge tone={copy.tone} label={copy.badge} pulse={false} />
      </View>
      <View style={styles.route}>
        <View style={styles.dots}>
          <View style={styles.pickupDot} />
          <View style={styles.connector} />
          <View style={styles.destinationSquare} />
        </View>
        <View style={styles.flex}>
          <Txt variant="body-md" numberOfLines={1}>{trip.pickup.address ?? 'Điểm đón đã ghim'}</Txt>
          <Txt variant="body-md" numberOfLines={1}>{trip.destination.address ?? 'Điểm đến đã ghim'}</Txt>
        </View>
      </View>
      <View style={styles.cardBottom}>
        <Txt variant="body-sm" color={colors.slateMuted}>{vehicleTier(trip.vehicleType).title}</Txt>
        <Txt variant="title-md" weight="bold" tabular>{formatVnd(trip.fare.finalAmount ?? trip.fare.estimatedAmount)}</Txt>
      </View>
    </Card>
  );
}

/** Tab "Hoạt động": lịch sử Trip (cursor), lọc theo trạng thái kết thúc. */
export function ActivityScreen() {
  const { trips } = useRider();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [items, setItems] = useState<RiderTrip[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (reset: boolean, from: string | null, status: Filter) => {
    setLoading(true);
    setError(null);
    try {
      const page = await trips.history({ cursor: reset ? null : from, status: status === 'ALL' ? null : status });
      setItems((previous) => (reset ? page.items : [...previous, ...page.items.filter((item) => !previous.some((old) => old.tripId === item.tripId))]));
      setCursor(page.nextCursor);
      setLoaded(true);
    } catch (failure) {
      // Cursor gắn với bộ lọc; sai thì tải lại trang đầu.
      if (failure instanceof RiderError && failure.code === 'INVALID_CURSOR' && !reset) return load(true, null, status);
      setError(failure);
    } finally {
      setLoading(false);
    }
  }, [trips]);

  useFocusEffect(useCallback(() => { void load(true, null, filter); }, [load, filter]));

  return (
    <View style={styles.root}>
      <AppHeader title="Hoạt động" right={<ProfileAvatar />} />
      <View style={styles.filters}>
        {FILTERS.map((item) => {
          const selected = item.value === filter;
          return (
            <Pressable key={item.value} accessibilityRole="tab" accessibilityState={{ selected }} onPress={() => setFilter(item.value)}
              style={[styles.filter, selected && styles.filterSelected]}>
              <Txt variant="label-md" color={selected ? colors.onPrimary : colors.onSurfaceVariant}>{item.label}</Txt>
            </Pressable>
          );
        })}
      </View>
      <FlatList
        data={items}
        keyExtractor={(item) => item.tripId}
        renderItem={({ item }) => <HistoryCard trip={item} />}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading && loaded} onRefresh={() => { void load(true, null, filter); }} tintColor={colors.primary} />}
        ListHeaderComponent={error ? <Banner tone="error" message={errorText(error)} /> : null}
        ListEmptyComponent={!loaded ? <Loading label="Đang tải lịch sử…" /> : (
          <EmptyState icon="receipt_long" title="Chưa có chuyến nào" message="Các chuyến đã hoàn thành hoặc đã huỷ sẽ hiện ở đây." />
        )}
        ListFooterComponent={cursor ? (
          <SecondaryButton label="Tải thêm" loading={loading} onPress={() => { void load(false, cursor, filter); }} />
        ) : null}
      />
    </View>
  );
}

const HISTORY_LABELS: Record<TripStatus, string> = {
  CREATED: 'Tạo chuyến', SEARCHING: 'Bắt đầu tìm tài xế', ASSIGNED: 'Tài xế nhận chuyến', DRIVER_ARRIVED: 'Tài xế đến điểm đón',
  IN_PROGRESS: 'Bắt đầu chuyến đi', COMPLETED: 'Hoàn thành', CANCELLED: 'Huỷ chuyến',
};
const ACTOR_LABELS = { RIDER: 'Bạn', DRIVER: 'Tài xế', SYSTEM: 'Hệ thống' } as const;

/** Chi tiết một chuyến (Trip GET /trips/{id}) kèm lịch sử trạng thái. */
export function TripDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { trips } = useRider();
  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [error, setError] = useState<unknown>(null);

  useFocusEffect(useCallback(() => {
    if (!id) return;
    const controller = new AbortController();
    trips.detail(id, controller.signal).then(setDetail).catch((failure: unknown) => {
      if (!(failure instanceof RiderError && failure.code === 'CANCELLED')) setError(failure);
    });
    return () => controller.abort();
  }, [id, trips]));

  const trip = detail?.trip;
  return (
    <RiderScreen title="Chi tiết chuyến">
      {error ? <Banner tone="error" message={errorText(error)} /> : null}
      {!trip && !error ? <Loading label="Đang tải chuyến…" /> : null}
      {trip ? (
        <>
          <View style={styles.cardTop}>
            <StatusBadge tone={STATUS_COPY[trip.status].tone} label={STATUS_COPY[trip.status].badge} pulse={!isTerminal(trip.status)} />
            <Txt variant="label-md" color={colors.onSurfaceVariant}>{formatDateTime(trip.timestamps.requestedAt)}</Txt>
          </View>
          {!isTerminal(trip.status) ? <PrimaryButton label="Theo dõi chuyến" icon="navigation" onPress={() => router.replace('/')} /> : null}
          {trip.cancellation ? (
            <Banner tone="warning" title={`${ACTOR_LABELS[trip.cancellation.actorType]} đã huỷ chuyến`} message={`Lý do: ${trip.cancellation.reason}`} />
          ) : null}
          <DriverCard trip={trip} />
          <TripWaypoints trip={trip} />
          <FareCard trip={trip} final={trip.status === 'COMPLETED'} />
          <Card style={styles.timeline}>
            <Txt variant="label-lg">Lịch sử trạng thái</Txt>
            {detail.statusHistory.map((entry, index) => (
              <View key={entry.version} style={styles.timelineRow}>
                <View style={styles.timelineRail}>
                  <View style={[styles.timelineDot, index === detail.statusHistory.length - 1 && styles.timelineDotCurrent]} />
                  {index < detail.statusHistory.length - 1 ? <View style={styles.timelineLine} /> : null}
                </View>
                <View style={styles.flex}>
                  <Txt variant="body-md">{HISTORY_LABELS[entry.toStatus]}</Txt>
                  <Txt variant="body-sm" color={colors.slateMuted}>{formatDateTime(entry.occurredAt)} · {ACTOR_LABELS[entry.actorType]}</Txt>
                </View>
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </RiderScreen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1, minWidth: 0 },
  filters: { flexDirection: 'row', gap: space.xs, paddingHorizontal: space.gutter, paddingVertical: space.sm },
  filter: { paddingHorizontal: space.md, paddingVertical: space.xs + 2, borderRadius: radius.full, backgroundColor: colors.surfaceContainer },
  filterSelected: { backgroundColor: colors.primary },
  list: { padding: space.gutter, paddingTop: space.xs, gap: space.sm },
  card: { gap: space.sm },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  route: { flexDirection: 'row', gap: space.sm },
  dots: { alignItems: 'center', paddingTop: 6, width: 12 },
  pickupDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.tertiary },
  connector: { width: 2, flex: 1, minHeight: 10, backgroundColor: colors.outlineVariant, marginVertical: 2 },
  destinationSquare: { width: 8, height: 8, borderRadius: 2, backgroundColor: colors.error, marginBottom: 6 },
  timeline: { gap: space.xs },
  timelineRow: { flexDirection: 'row', gap: space.sm },
  timelineRail: { alignItems: 'center', width: 12, paddingTop: 6 },
  timelineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.outlineVariant },
  timelineDotCurrent: { backgroundColor: colors.primary },
  timelineLine: { width: 2, flex: 1, minHeight: 18, backgroundColor: colors.outlineVariant, marginTop: 2 },
});
