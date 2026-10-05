import { useCallback } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { useDriverRuntime } from '../state/driver-provider';
import { useFocusedResource } from '../hooks/use-focused-resource';
import { TripCard } from '../components/trip-card';
import { Action, Busy, Card, ErrorNotice, Notice, Screen } from '../components/ui';

export function TripDetailScreen() {
  const runtime = useDriverRuntime();
  const { id } = useLocalSearchParams<{ id: string }>();
  const valid = typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const resource = useFocusedResource(useCallback((signal: AbortSignal) => runtime.trip.detail(id, signal), [runtime, id]), valid && runtime.trip.enabled);
  return (
    <Screen title="Chi tiết chuyến" backToDriver>
      {!valid && <Notice>Mã chuyến không hợp lệ.</Notice>}
      {!runtime.trip.enabled && <Notice>Trip chưa được cấu hình hoặc JWT trust chưa được xác nhận.</Notice>}
      <Action label="Đọc lại chi tiết" onPress={resource.refresh} disabled={!valid || !runtime.trip.enabled || resource.loading} />
      <Busy visible={resource.loading} /><ErrorNotice error={resource.error} />
      {resource.data && <>
        <TripCard trip={resource.data.trip} />
        <ThemedText>Lịch sử trạng thái</ThemedText>
        {resource.data.statusHistory.map((entry) => <Card key={entry.version}>
          <Notice>{entry.occurredAt} · v{entry.version} · {entry.actorType}</Notice>
          <ThemedText>{entry.fromStatus ?? '—'} → {entry.toStatus}</ThemedText>
        </Card>)}
      </>}
    </Screen>
  );
}
