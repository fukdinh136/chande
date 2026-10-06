import { StyleSheet, View } from 'react-native';
import {
  Avatar, Banner, Card, Divider, Icon, PrimaryButton, PulseDot, SecondaryButton, StatusBadge, Txt, WaypointCard, colors, radius, space,
  type StatusTone,
} from '@/design';
import { errorText } from '../errors';
import { fareLabel, formatDateTime, formatDistance, formatDuration, formatTime, formatVnd } from '../format';
import { isCancellable, type RiderTrip, type TripStatus } from '../models';
import type { RealtimeStatus } from '../realtime';
import { vehicleTier } from '../vehicles';

export const STATUS_COPY: Record<TripStatus, { tone: StatusTone; badge: string; title: string; message: string }> = {
  CREATED: { tone: 'searching', badge: 'Đã tạo', title: 'Đang gửi yêu cầu', message: 'Chuyến đã được ghi nhận, đang chuyển sang tìm tài xế.' },
  SEARCHING: { tone: 'searching', badge: 'Đang tìm tài xế', title: 'Đang tìm tài xế gần bạn', message: 'Chande đang mời lần lượt các tài xế phù hợp. Bạn vẫn có thể huỷ chuyến.' },
  ASSIGNED: { tone: 'enroute', badge: 'Tài xế đang đến', title: 'Tài xế đang đến điểm đón', message: 'Hãy có mặt ở điểm đón đúng giờ.' },
  DRIVER_ARRIVED: { tone: 'enroute', badge: 'Tài xế đã đến', title: 'Tài xế đã đến điểm đón', message: 'Kiểm tra biển số xe trước khi lên xe.' },
  IN_PROGRESS: { tone: 'enroute', badge: 'Đang di chuyển', title: 'Đang trên đường đến điểm trả', message: 'Chúc bạn có chuyến đi an toàn.' },
  COMPLETED: { tone: 'completed', badge: 'Hoàn thành', title: 'Chuyến đi đã hoàn tất', message: 'Cảm ơn bạn đã đi cùng Chande.' },
  CANCELLED: { tone: 'cancelled', badge: 'Đã huỷ', title: 'Chuyến đã bị huỷ', message: '' },
};

export function DriverCard({ trip }: { trip: RiderTrip }) {
  if (!trip.driver) return null;
  const vehicle = trip.vehicle;
  const description = [vehicle ? vehicleTier(vehicle.vehicleType).title : null, vehicle?.brand, vehicle?.color].filter(Boolean).join(' · ');
  return (
    <Card style={styles.driver}>
      <Avatar name={trip.driver.fullName} uri={trip.driver.avatarUrl} size={48} />
      <View style={styles.driverText}>
        <Txt variant="title-md" numberOfLines={1}>{trip.driver.fullName}</Txt>
        {description ? <Txt variant="body-sm" color={colors.onSurfaceVariant} numberOfLines={1}>{description}</Txt> : null}
      </View>
      {vehicle ? (
        <View style={styles.plate} accessibilityLabel={`Biển số ${vehicle.licensePlate}`}>
          <Txt variant="label-lg" weight="bold" tabular>{vehicle.licensePlate}</Txt>
        </View>
      ) : null}
    </Card>
  );
}

export function TripWaypoints({ trip }: { trip: RiderTrip }) {
  return (
    <WaypointCard
      pickup={{ label: 'Điểm đón', title: trip.pickup.address ?? null, placeholder: 'Vị trí đã ghim' }}
      destination={{ label: 'Điểm đến', title: trip.destination.address ?? null, placeholder: 'Vị trí đã ghim' }}
    />
  );
}

export function FareCard({ trip, final = false }: { trip: RiderTrip; final?: boolean }) {
  const amount = final ? trip.fare.finalAmount ?? trip.fare.estimatedAmount : trip.fare.estimatedAmount;
  return (
    <Card style={styles.fare}>
      <View style={styles.fareRow}>
        <View style={styles.fareLabel}>
          <Icon name="payments" size={18} color={colors.primary} />
          <Txt variant="label-md">{final ? 'Tổng tiền · Tiền mặt' : 'Giá dự kiến · Tiền mặt'}</Txt>
        </View>
        <Txt variant="headline-sm" weight="bold" tabular color={colors.primary}>{formatVnd(amount)}</Txt>
      </View>
      {trip.fare.breakdown.length ? <Divider /> : null}
      {trip.fare.breakdown.map((line) => (
        <View key={line.code} style={styles.fareRow}>
          <Txt variant="body-sm" color={colors.onSurfaceVariant}>{fareLabel(line.code)}</Txt>
          <Txt variant="body-sm" tabular>{formatVnd(line.amount)}</Txt>
        </View>
      ))}
      <Txt variant="body-sm" color={colors.slateMuted}>
        {vehicleTier(trip.vehicleType).title} · {formatDistance(trip.route.distanceMeters)} · {formatDuration(trip.route.durationSeconds)}
      </Txt>
    </Card>
  );
}

function LiveIndicator({ status, pollSeconds }: { status: RealtimeStatus; pollSeconds: number }) {
  const live = status === 'live';
  return (
    <View style={styles.live}>
      <PulseDot color={live ? colors.tertiaryFixedDim : colors.outline} active={live} size={6} />
      <Txt variant="label-sm" color={colors.onSurfaceVariant}>{live ? 'Cập nhật trực tiếp' : `Cập nhật mỗi ${pollSeconds} giây`}</Txt>
    </View>
  );
}

/** Nội dung sheet khi có chuyến đang diễn ra. */
export function TripPanel({ trip, realtime, pollSeconds, error, onCancel }: {
  trip: RiderTrip; realtime: RealtimeStatus; pollSeconds: number; error: unknown; onCancel: () => void;
}) {
  const copy = STATUS_COPY[trip.status];
  return (
    <View style={styles.panel}>
      <View style={styles.statusRow}>
        <StatusBadge tone={copy.tone} label={copy.badge} />
        <LiveIndicator status={realtime} pollSeconds={pollSeconds} />
      </View>
      <View style={styles.headline}>
        <Txt variant="headline-sm">{copy.title}</Txt>
        <Txt variant="body-md" color={colors.onSurfaceVariant}>{copy.message}</Txt>
        <Txt variant="body-sm" color={colors.slateMuted}>Đặt lúc {formatTime(trip.timestamps.requestedAt)}</Txt>
      </View>
      {error ? <Banner tone="warning" message={errorText(error)} /> : null}
      <DriverCard trip={trip} />
      <TripWaypoints trip={trip} />
      <FareCard trip={trip} />
      {isCancellable(trip.status) ? <SecondaryButton label="Huỷ chuyến" tone="danger" icon="close" onPress={onCancel} /> : null}
    </View>
  );
}

/** Kết quả chuyến vừa kết thúc: hoá đơn khi hoàn thành, lý do khi bị huỷ. */
export function FinishedPanel({ trip, onDone }: { trip: RiderTrip; onDone: () => void }) {
  const completed = trip.status === 'COMPLETED';
  const cancelledBy = trip.cancellation?.actorType === 'DRIVER' ? 'Tài xế đã huỷ chuyến.' : 'Bạn đã huỷ chuyến.';
  return (
    <View style={styles.panel}>
      <View style={styles.result}>
        <View style={[styles.resultIcon, { backgroundColor: completed ? '#D1FAE5' : '#FFE4E6' }]}>
          <Icon name={completed ? 'verified' : 'cancel'} size={30} color={completed ? '#065F46' : '#BE123C'} />
        </View>
        <Txt variant="headline-md" align="center">{STATUS_COPY[trip.status].title}</Txt>
        {completed ? (
          <Txt variant="display-lg" tabular color={colors.primary}>{formatVnd(trip.fare.finalAmount ?? trip.fare.estimatedAmount)}</Txt>
        ) : (
          <Txt variant="body-md" align="center" color={colors.onSurfaceVariant}>
            {cancelledBy}{trip.cancellation?.reason ? ` Lý do: ${trip.cancellation.reason}` : ''}
          </Txt>
        )}
        <Txt variant="body-sm" color={colors.slateMuted}>
          {formatDateTime(completed ? trip.timestamps.completedAt : trip.timestamps.cancelledAt)}
        </Txt>
      </View>
      <DriverCard trip={trip} />
      <TripWaypoints trip={trip} />
      {completed ? <FareCard trip={trip} final /> : null}
      <PrimaryButton label="Đặt chuyến mới" icon="bolt" onPress={onDone} />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: space.md },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  headline: { gap: 2 },
  live: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  driver: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  driverText: { flex: 1, minWidth: 0 },
  plate: { paddingHorizontal: space.sm, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.hairline },
  fare: { gap: space.sm },
  fareRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  fareLabel: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  result: { alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  resultIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
});
