import { useCallback } from 'react';
import { Link } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { useDriverRuntime, useDriverSession } from '../state/driver-provider';
import { useFocusedResource } from '../hooks/use-focused-resource';
import { useMutation } from '../hooks/use-mutation';
import { Action, Busy, Card, ErrorNotice, Notice, Screen } from '../components/ui';
import { TripCard } from '../components/trip-card';
import { GpsCard } from '../gps/gps-card';

export function OverviewScreen() {
  const runtime = useDriverRuntime();
  const session = useDriverSession();
  const intent = useFocusedResource(useCallback((signal: AbortSignal) => runtime.driver.availability(signal), [runtime]), !!session.session, 10000);
  const active = useFocusedResource(useCallback((signal: AbortSignal) => runtime.trip.active(signal), [runtime]), !!session.session && runtime.trip.enabled, runtime.config.pollIntervalMs);
  const mutation = useMutation();
  const refresh = () => { intent.refresh(); active.refresh(); };
  return (
    <Screen title="Tài xế Chande">
      <Link href="/driver/profile"><ThemedText type="linkPrimary">Hồ sơ</ThemedText></Link>
      <Link href="/driver/vehicles"><ThemedText type="linkPrimary">Phương tiện</ThemedText></Link>
      <Link href="/driver/trip"><ThemedText type="linkPrimary">Chuyến hiện tại</ThemedText></Link>
      <Link href="/driver/history"><ThemedText type="linkPrimary">Lịch sử chuyến</ThemedText></Link>
      <Card>
        <ThemedText>Ý định nhận cuốc: {intent.data?.desiredStatus ?? 'Chưa đọc được'}</ThemedText>
        <Notice>Trạng thái vận hành: {intent.data?.realtimeStatus ?? 'UNKNOWN'}</Notice>
        <Notice>Xe đang chọn: {intent.data?.selectedVehicleId ?? 'Chưa xác định hoặc chưa chọn'}</Notice>
        {intent.data?.realtimeSync === 'PENDING' && <Notice>Ý định đã được lưu; đồng bộ realtime đang chờ. Hãy đọc lại trạng thái sau.</Notice>}
        <Notice>ONLINE chưa bảo đảm có thể nhận cuốc. Tắt nhận cuốc không hủy chuyến đang chạy.</Notice>
        <Action label="Bật ý định nhận cuốc (ONLINE)" disabled={mutation.busy || intent.loading || intent.data?.desiredStatus === 'ONLINE'}
          onPress={() => { void mutation.run(async () => { intent.replace(await runtime.driver.setAvailability('ONLINE')); refresh(); }); }} />
        <Action label="Tắt ý định nhận cuốc (OFFLINE)" disabled={mutation.busy || intent.loading || intent.data?.desiredStatus === 'OFFLINE'}
          onPress={() => { void mutation.run(async () => { intent.replace(await runtime.driver.setAvailability('OFFLINE')); refresh(); }); }} />
        <Busy visible={intent.loading || mutation.busy} /><ErrorNotice error={intent.error || mutation.error} />
      </Card>
      <GpsCard desiredStatus={intent.error ? undefined : intent.data?.desiredStatus} selectedVehicleId={intent.data?.selectedVehicleId} />
      <Action label="Đọc lại trạng thái" onPress={refresh} disabled={intent.loading || active.loading || mutation.busy} />
      {!runtime.trip.enabled ? <Notice>Trip chưa được cấu hình. Hồ sơ, xe và ý định nhận cuốc vẫn dùng API Driver; thao tác đổi xe cần backend xác minh Trip.</Notice> : <>
        <Busy visible={active.loading} /><ErrorNotice error={active.error} />
        {active.data ? <TripCard trip={active.data} /> : active.checkedAt && !active.error ? <Notice>Không có chuyến đang hoạt động ở lần đọc gần nhất.</Notice> : null}
        <Notice>Chuyến được đọc bằng polling khi màn hình hoạt động, khoảng {runtime.config.pollIntervalMs / 1000}s; có thể chưa phải trạng thái mới nhất.</Notice>
      </>}
      <Notice>{runtime.matching.reason}</Notice>
      <Action label="Đăng xuất" disabled={mutation.busy} onPress={() => { void mutation.run(() => runtime.session.logout()); }} />
    </Screen>
  );
}
