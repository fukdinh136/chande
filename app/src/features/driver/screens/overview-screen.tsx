import { ThemedText } from '@/components/themed-text';
import { useDriverRuntime } from '../state/driver-provider';
import { useDriverResources } from '../state/session-resources';
import { useOffers } from '../state/offers-provider';
import { OfferWorkflowNotice } from '../components/offer-workflow-notice';
import { DriverCapabilities } from '../components/driver-capabilities';
import { useMutation } from '../hooks/use-mutation';
import { useFocusedResource } from '../hooks/use-focused-resource';
import { Action, Busy, Card, ErrorNotice, Notice, RouteAction, Screen } from '../components/ui';
import { TripCard } from '../components/trip-card';
import {RideMap} from '../../map/ride-map';
import {useLocation} from '../../map/location-store';
import { GpsDetails } from '../gps/gps-card';
import { availabilityLabel, operationalLabels, shortId, vehicleLabel } from '../presentation/format';
import type { Trip } from '../contracts/models';

export function OverviewScreen() {
  const runtime = useDriverRuntime(), offers = useOffers();
  const {intent,active,store} = useDriverResources();
  const vehicles = useFocusedResource(store.vehicles);
  const mutation = useMutation(runtime.session);
  const refresh = () => { intent.refresh(); active.refresh(); vehicles.refresh(); };
  const selected = vehicles.data?.find(vehicle => vehicle.vehicleId === intent.data?.selectedVehicleId);
  const locked = mutation.busy || intent.loading || !intent.data || !!intent.error;
  const lockReason = !intent.data ? 'Đang kiểm tra trạng thái trước khi thay đổi nhận cuốc.' : intent.error ? 'Hãy đọc lại trạng thái trước khi thay đổi nhận cuốc.' : null;
  const setAvailability = (status: 'ONLINE' | 'OFFLINE') => { void mutation.run(async isCurrent => {
    const value = await runtime.driver.setAvailability(status);
    if (isCurrent()) { intent.replace(value); refresh(); }
  }); };
  return (
    <Screen title="Trang chủ tài xế">
      {runtime.trip.enabled && <>
        {active.data ? <>
          <ThemedText type="smallBold" accessibilityRole="header">Chuyến hiện tại</ThemedText>
          {active.error && <Notice>Đang hiển thị chuyến ở lần đọc gần nhất; cần đọc lại để xác nhận.</Notice>}
          <TripCard trip={active.data} />
          <RouteAction href="/driver/trip" label="Mở chuyến hiện tại" />
        </> : active.loading || !active.checkedAt ? <Notice>Đang kiểm tra chuyến hiện tại…</Notice> : !active.error ? <Notice>Hiện chưa có chuyến đang hoạt động.</Notice> : null}
        <ErrorNotice error={active.error} />
      </>}
      <OfferWorkflowNotice/>
      {offers.phase === 'available' && <RouteAction href="/driver/offers" label={`Xem lời mời mới · còn khoảng ${offers.remaining} giây`} />}
      <Card>
        <ThemedText type="smallBold" accessibilityRole="header">{availabilityLabel(intent.data, intent.loading, intent.error)}</ThemedText>
        {intent.data && <>
          {intent.error && <Notice>Dữ liệu lần đọc gần nhất:</Notice>}
          <Notice>Ý định: {intent.data.desiredStatus === 'ONLINE' ? 'Bật nhận cuốc (ONLINE)' : 'Tắt nhận cuốc (OFFLINE)'}</Notice>
          <Notice>{operationalLabels[intent.data.realtimeStatus]}</Notice>
          <Notice>{intent.data.selectedVehicleId ? selected ? `Xe đã chọn: ${selected.licensePlate} · ${vehicleLabel(selected.vehicleType)}` : `Xe đã chọn: #${shortId(intent.data.selectedVehicleId)}; ${vehicles.loading ? 'đang tải thông tin xe' : 'chưa đọc được thông tin xe'}` : 'Chưa chọn xe nhận cuốc'}</Notice>
          {vehicles.error && <Notice>Chưa đọc được biển số xe. Mở Phương tiện để kiểm tra lại.</Notice>}
          {intent.data.realtimeSync === 'PENDING' && <Notice>Ý định đã lưu, đang chờ đồng bộ nhận chuyến.</Notice>}
          {intent.data.desiredStatus === 'ONLINE' && <Notice>Bật nhận cuốc chưa bảo đảm có lời mời. Cần xe hợp lệ, GPS mới và hệ thống xác nhận sẵn sàng.</Notice>}
        </>}
        {lockReason && <Notice>{lockReason}</Notice>}
        {!intent.data?.selectedVehicleId && intent.data?.desiredStatus === 'OFFLINE' && <Notice>Chọn xe trước khi bật nhận cuốc.</Notice>}
        {intent.data?.desiredStatus === 'ONLINE' ? <Action label="Tắt nhận cuốc" busy={mutation.busy} disabled={locked} variant="secondary" onPress={() => setAvailability('OFFLINE')} />
          : <Action label="Bật nhận cuốc" busy={mutation.busy} disabled={locked || !intent.data?.selectedVehicleId} onPress={() => setAvailability('ONLINE')} />}
        <Notice>Tắt nhận cuốc không hủy chuyến đang chạy.</Notice>
        <RouteAction href="/driver/vehicles" label="Quản lý và chọn phương tiện" />
        <Busy visible={intent.loading} /><ErrorNotice error={intent.error || mutation.error} />
      </Card>
      <GpsDetails />
      <HomeMap trip={active.data}/>
      <Action label="Cập nhật trạng thái" variant="secondary" onPress={refresh} disabled={intent.loading || active.loading || vehicles.loading || mutation.busy} />
      <DriverCapabilities/>
      <RouteAction href="/driver/offers" label="Lời mời chuyến" />
      <RouteAction href="/driver/profile" label="Hồ sơ tài xế" />
      <RouteAction href="/driver/history" label="Lịch sử chuyến" />
    </Screen>
  );
}
function HomeMap({ trip }: { trip: Trip | null | undefined }) {
  const position = useLocation();
  return <RideMap pickup={trip?.pickup} destination={trip?.destination} position={position} fitKey={trip ? `${trip.tripId}:${trip.status}` : 'home'} height={220}/>;
}
