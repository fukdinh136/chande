import { useCallback, useEffect, useState } from 'react';
import { Link } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { nextStatus } from '../contracts/models';
import { useDriverRuntime, useTripCommands } from '../state/driver-provider';
import { useFocusedResource } from '../hooks/use-focused-resource';
import { TripCard } from '../components/trip-card';
import { Action, Busy, Card, ErrorNotice, Field, Notice, Screen } from '../components/ui';
import {NavigationCard} from '../../navigation/navigation-card';

const actions = { DRIVER_ARRIVED: 'Đã đến điểm đón', IN_PROGRESS: 'Bắt đầu chuyến', COMPLETED: 'Hoàn thành chuyến' };
export function ActiveTripScreen() {
  const runtime = useDriverRuntime();
  const commands = useTripCommands();
  const resource = useFocusedResource(useCallback((signal: AbortSignal) => runtime.trip.active(signal), [runtime]), runtime.trip.enabled, runtime.config.pollIntervalMs);
  const [reason, setReason] = useState('');
  const refresh = resource.refresh;
  useEffect(() => {
    // Wire adapters only invalidate REST data. Never trust an unversioned socket payload as Trip state.
    return runtime.realtime.subscribe((notice) => {
      if (notice.kind === 'reconnected' || notice.kind === 'trip-invalidated') refresh();
    });
  }, [runtime, refresh]);
  const trip = resource.data;
  const next = trip ? nextStatus(trip) : null;
  const blocked = commands.busy || commands.restoring || !!commands.pending || resource.loading || !!resource.error;
  const refreshAfter = async (job: () => Promise<void>) => { await job(); resource.refresh(); };
  return (
    <Screen title="Chuyến hiện tại" backToDriver>
      {!runtime.trip.enabled && <Notice>Trip chưa được cấu hình hoặc chưa xác nhận JWT trust. Không tạo chuyến hoặc offer giả.</Notice>}
      <Action label="Đọc lại chuyến" disabled={!runtime.trip.enabled || resource.loading || commands.busy} onPress={resource.refresh} />
      <Busy visible={resource.loading || commands.busy || commands.restoring} />
      <ErrorNotice error={resource.error || commands.error} />
      {commands.restoring && !!commands.error && <Action label="Đọc lại lệnh đã lưu" disabled={commands.busy} onPress={() => { void commands.manager.reloadStoredCommand(); }} />}
      {commands.message && <Notice>{commands.message}</Notice>}
      {commands.pending && <Card>
        <Notice>Thao tác trước chưa có xác nhận. Thử lại để kiểm tra kết quả.</Notice>
        <Action label="Thử lại đúng lệnh đã lưu" disabled={!runtime.trip.enabled || commands.busy || commands.restoring} onPress={() => { void refreshAfter(() => commands.manager.retry()); }} />
      </Card>}
      {trip && <>
        <NavigationCard trip={trip}/>
        <TripCard trip={trip} />
        <Link href={{ pathname: '/driver/trips/[id]', params: { id: trip.tripId } }}><ThemedText type="linkPrimary">Chi tiết và lịch sử trạng thái</ThemedText></Link>
        {next && <Action label={actions[next]} disabled={blocked} onPress={() => { void refreshAfter(() => commands.manager.advance(trip)); }} />}
        {['CREATED', 'SEARCHING', 'ASSIGNED', 'DRIVER_ARRIVED'].includes(trip.status) && <>
          <Field label="Lý do hủy (1–500 ký tự)" value={reason} onChangeText={setReason} multiline editable={!blocked} />
          <Action label="Hủy chuyến" disabled={blocked || !reason.trim()} onPress={() => { void refreshAfter(() => commands.manager.cancel(trip, reason)); }} />
        </>}
      </>}
      {resource.checkedAt && !trip && !resource.error && <Notice>Không có chuyến đang hoạt động ở lần đọc gần nhất.</Notice>}

    </Screen>
  );
}
