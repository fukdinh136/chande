import { ThemedText } from '@/components/themed-text';
import { useDriverRuntime } from '../state/driver-provider';
import { useOffers } from '../state/offers-context';
import { Chip, vnd } from '../../ui/design';
import { RideMap } from '../../map/ride-map';
import { Action, Busy, Card, Notice, Screen } from '../components/ui';
import { OfferWorkflowNotice } from '../components/offer-workflow-notice';
import { vehicleLabel } from '../presentation/format';

export function OffersScreen({ modal = false }: { modal?: boolean }) {
  const runtime = useDriverRuntime(), resource = useOffers(), current = resource.data;
  return <Screen title="Lời mời chuyến" backToDriver modal={modal}>
    <Action label="Đối soát lời mời và chuyến" onPress={resource.refreshAll} disabled={!runtime.matching.available || resource.loading || resource.busy} />
    <Busy visible={resource.loading || resource.busy || !resource.ready} />
    <OfferWorkflowNotice />
    {!runtime.matching.available ? <Notice>{runtime.matching.reason}</Notice> : current ? <Card>
      <Chip tone="warning">{resource.phase === 'available' ? `${resource.remaining}s · Lời mời chuyến mới` : `Matching: ${current.status}`}</Chip>
      <ThemedText type="subtitle">{vnd(current.fare.amount)}</ThemedText>
      <Notice>{vehicleLabel(current.vehicleType)} · Giá chuyến</Notice>
      <RideMap pickup={current.pickup} destination={current.destination} fitKey={current.offerId} height={180} />
      <Notice>Đón: {current.pickup.address ?? `${current.pickup.lat}, ${current.pickup.lng}`}</Notice>
      <Notice>Đến: {current.destination.address ?? `${current.destination.lat}, ${current.destination.lng}`}</Notice>
      {resource.phase === 'available' && <>
        <Notice>Còn khoảng {resource.remaining}s; server quyết định hạn lời mời.</Notice>
        {!runtime.trip.enabled ? <Notice>{runtime.capabilities.trip.reason} Cần Trip để theo dõi assignment.</Notice> : !resource.canAccept && <Notice>Chỉ nhận khi đã đọc được Trip và tài xế không có chuyến đang hoạt động.</Notice>}
        <Action label="Nhận chuyến →" disabled={!resource.canAccept} onPress={() => resource.decide('accept')} />
        <Action label="Bỏ qua" variant="secondary" disabled={!resource.canDecide} onPress={() => resource.decide('decline')} />
      </>}
    </Card> : resource.ready && resource.checkedAt && !resource.loading && !resource.error ? <Notice>Hiện không có lời mời. Bật ONLINE, chọn xe và gửi GPS mới để backend tìm được tài xế.</Notice> : null}
    <Notice>Khi nhận chuyến, vui lòng chờ Trip xác nhận trước khi di chuyển.</Notice>
  </Screen>;
}
