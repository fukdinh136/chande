import { useState } from 'react';
import { Link } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { nextStatus } from '../contracts/models';
import { useDriverRuntime, useTripCommands } from '../state/driver-provider';
import { useDriverResources } from '../state/session-resources';
import { TripCard } from '../components/trip-card';
import { Action, Busy, Card, ErrorNotice, Field, Notice, Screen } from '../components/ui';
import { DriverNavigationCard } from '../navigation/navigation-card';
import { OfferWorkflowNotice } from '../components/offer-workflow-notice';

const actions = { DRIVER_ARRIVED: 'Đã đến điểm đón', IN_PROGRESS: 'Bắt đầu chuyến', COMPLETED: 'Hoàn thành chuyến' };
export function ActiveTripScreen() {
  const runtime = useDriverRuntime();
  const commands = useTripCommands();
  const {active:resource} = useDriverResources();
  const [reason, setReason] = useState('');
  const trip = resource.data;
  const next = trip ? nextStatus(trip) : null;
  const blocked = commands.busy || commands.restoring || !!commands.pending || resource.loading || !!resource.error;
  return (
    <Screen title="Chuyến hiện tại" backToDriver>
      {!runtime.trip.enabled && <Notice>{runtime.capabilities.trip.reason}</Notice>}
      <OfferWorkflowNotice showTripLink={false}/>
      <Action label="Đọc lại chuyến" disabled={!runtime.trip.enabled || resource.loading || commands.busy} onPress={resource.refresh} />
      <Busy visible={resource.loading || commands.busy || commands.restoring} />
      <ErrorNotice error={resource.error || commands.error} />
      {commands.restoring && !!commands.error && <Action label="Đọc lại lệnh đã lưu" disabled={commands.busy} onPress={() => { void commands.manager.reloadStoredCommand(); }} />}
      {commands.message && <Notice>{commands.message}</Notice>}
      {commands.pending && <Card>
        <Notice>Thao tác trước chưa có xác nhận. Thử lại để kiểm tra kết quả.</Notice>
        <Action label="Thử lại đúng lệnh đã lưu" disabled={!runtime.trip.enabled || commands.busy || commands.restoring} onPress={() => { void commands.manager.retry(); }} />
      </Card>}
      {trip && <>
        <DriverNavigationCard key={`${trip.tripId}:${trip.status}`} trip={trip} verified={!resource.error} />
        <TripCard trip={trip} />
        <Link href={{ pathname: '/driver/trips/[id]', params: { id: trip.tripId } }}><ThemedText type="linkPrimary">Chi tiết và lịch sử trạng thái</ThemedText></Link>
        {next && <Action label={actions[next]} disabled={blocked} onPress={() => { void commands.manager.advance(trip); }} />}
        {['CREATED', 'SEARCHING', 'ASSIGNED', 'DRIVER_ARRIVED'].includes(trip.status) && <>
          <Field label="Lý do hủy (1–500 ký tự)" value={reason} onChangeText={setReason} multiline editable={!blocked} />
          <Action label="Hủy chuyến" disabled={blocked || !reason.trim() || reason.trim().length > 500} onPress={() => { void commands.manager.cancel(trip, reason); }} />
        </>}
      </>}
      {resource.checkedAt && !resource.loading && !trip && !resource.error && <Notice>Không có chuyến đang hoạt động ở lần đọc gần nhất.</Notice>}

    </Screen>
  );
}
