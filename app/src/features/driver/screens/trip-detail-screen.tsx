import { useLocalSearchParams } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { useDriverRuntime } from '../state/driver-provider';
import { useFocusedResource } from '../hooks/use-focused-resource';
import { TripCard } from '../components/trip-card';
import { Action, Busy, Card, ErrorNotice, Notice, Screen } from '../components/ui';
import { actorLabels, driverDate, tripLabels } from '../presentation/format';
import { useDriverResources } from '../state/session-resources';

export function TripDetailScreen() {
  const runtime = useDriverRuntime();
  const { id } = useLocalSearchParams<{ id: string }>();
  const valid = typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const { store } = useDriverResources();
  const resource = useFocusedResource(store.detail(valid ? id : ''), valid && runtime.trip.enabled);
  const detail = valid && resource.data?.trip.tripId === id.toLowerCase() ? resource.data : undefined;
  return (
    <Screen title="Chi tiết chuyến" backToDriver>
      {!valid && <Notice>Mã chuyến không hợp lệ.</Notice>}
      {!runtime.trip.enabled && <Notice>{runtime.capabilities.trip.reason}</Notice>}
      <Action label="Đọc lại chi tiết" onPress={resource.refresh} disabled={!valid || !runtime.trip.enabled || resource.loading} />
      <Busy visible={resource.loading} /><ErrorNotice error={resource.error} />
      {detail && <>
        {resource.error && <Notice>Đang hiển thị chi tiết ở lần đọc gần nhất.</Notice>}
        <TripCard trip={detail.trip} />
        <Card>
          <ThemedText type="smallBold">Thời gian chuyến</ThemedText>
          <Notice>Được phân công: {driverDate(detail.trip.timestamps?.assignedAt)}</Notice>
          <Notice>Đến điểm đón: {driverDate(detail.trip.timestamps?.driverArrivedAt)}</Notice>
          <Notice>Bắt đầu: {driverDate(detail.trip.timestamps?.startedAt)}</Notice>
          <Notice>Hoàn thành: {driverDate(detail.trip.timestamps?.completedAt)}</Notice>
          <Notice>Hủy: {driverDate(detail.trip.timestamps?.cancelledAt)}</Notice>
        </Card>
        <ThemedText accessibilityRole="header">Lịch sử trạng thái</ThemedText>
        {detail.statusHistory.map((entry) => <Card key={entry.version}>
          <Notice>{driverDate(entry.occurredAt)} · {actorLabels[entry.actorType]}</Notice>
          <ThemedText>{entry.fromStatus ? tripLabels[entry.fromStatus] : 'Khởi tạo'} → {tripLabels[entry.toStatus]}</ThemedText>
        </Card>)}
      </>}
    </Screen>
  );
}
