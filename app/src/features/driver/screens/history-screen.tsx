import { useCallback, useState } from 'react';
import { Link } from 'expo-router';
import { Pressable } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { useDriverRuntime } from '../state/driver-provider';
import { useFocusedResource } from '../hooks/use-focused-resource';
import { Action, Busy, ErrorNotice, Notice, Screen } from '../components/ui';
import { TripCard } from '../components/trip-card';

export function HistoryScreen() {
  const runtime = useDriverRuntime();
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const cursor = cursors[cursors.length - 1];
  const resource = useFocusedResource(useCallback((signal: AbortSignal) => runtime.trip.history(cursor, signal), [runtime, cursor]), runtime.trip.enabled);
  return (
    <Screen title="Lịch sử chuyến" backToDriver>
      {!runtime.trip.enabled && <Notice>Cần cấu hình Trip và JWT trust để xem lịch sử.</Notice>}
      <Busy visible={resource.loading} /><ErrorNotice error={resource.error} />
      <Action label="Tải lại trang đầu" disabled={!runtime.trip.enabled || resource.loading} onPress={() => { if (cursor === undefined) resource.refresh(); else setCursors([undefined]); }} />
      {resource.data?.items.length === 0 && !resource.error && <Notice>Trang này chưa có chuyến hoàn thành hoặc đã hủy.</Notice>}
      {resource.data?.items.map((trip) => <Link key={trip.tripId} href={{ pathname: '/driver/trips/[id]', params: { id: trip.tripId } }} asChild>
        <Pressable accessibilityRole="button" accessibilityLabel={`Chi tiết chuyến ${trip.tripId}`}><TripCard trip={trip} /></Pressable>
      </Link>)}
      <Notice>Trang {cursors.length}. Cursor do Trip phát hành, client chỉ chuyển tiếp nguyên giá trị.</Notice>
      <Action label="Trang trước" disabled={resource.loading || cursors.length === 1} onPress={() => setCursors((previous) => previous.slice(0, -1))} />
      <Action label="Trang sau" disabled={resource.loading || !!resource.error || !resource.data?.nextCursor} onPress={() => {
        const next = resource.data?.nextCursor;
        if (next) setCursors((previous) => [...previous, next]);
      }} />
      <ThemedText type="small">Lịch sử lấy từ Trip, không lưu bản sao tại Gateway demo.</ThemedText>
    </Screen>
  );
}
