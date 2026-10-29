import { useState } from 'react';
import { Link } from 'expo-router';
import { Pressable } from 'react-native';
import { useDriverRuntime } from '../state/driver-provider';
import { useFocusedResource } from '../hooks/use-focused-resource';
import { Action, Busy, ErrorNotice, Notice, Screen } from '../components/ui';
import { TripCard } from '../components/trip-card';
import { useDriverResources } from '../state/session-resources';

export function HistoryScreen() {
  const runtime = useDriverRuntime();
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const cursor = cursors[cursors.length - 1];
  const { store } = useDriverResources();
  const resource = useFocusedResource(store.history(cursor), runtime.trip.enabled);
  const page = resource.data?.cursor === cursor ? resource.data : undefined;
  return (
    <Screen title="Lịch sử chuyến" backToDriver>
      {!runtime.trip.enabled && <Notice>{runtime.capabilities.trip.reason}</Notice>}
      <Busy visible={resource.loading} /><ErrorNotice error={resource.error} />
      <Action label="Tải lại trang đầu" disabled={!runtime.trip.enabled || resource.loading} onPress={() => { if (cursor === undefined) resource.refresh(); else setCursors([undefined]); }} />
      {page && !!resource.error && <Notice>Đang hiển thị dữ liệu của lần đọc trước trên trang này.</Notice>}
      {page?.items.length === 0 && !resource.error && <Notice>Trang này chưa có chuyến hoàn thành hoặc đã hủy.</Notice>}
      {page?.items.map((trip) => <Link key={trip.tripId} href={{ pathname: '/driver/trips/[id]', params: { id: trip.tripId } }} asChild>
        <Pressable accessibilityRole="button" accessibilityLabel={`Chi tiết chuyến ${trip.tripId}`}><TripCard trip={trip} /></Pressable>
      </Link>)}
      <Notice>Trang {cursors.length}. </Notice>
      <Action label="Trang trước" disabled={resource.loading || cursors.length === 1} onPress={() => setCursors((previous) => previous.slice(0, -1))} />
      <Action label="Trang sau" disabled={resource.loading || !!resource.error || !page?.nextCursor} onPress={() => {
        const next = page?.nextCursor;
        if (next) setCursors((previous) => [...previous, next]);
      }} />
    </Screen>
  );
}
