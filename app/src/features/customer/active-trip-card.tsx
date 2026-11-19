import {View} from 'react-native';
import {router} from 'expo-router';
import {ThemedText} from '@/components/themed-text';
import {Action, Card, Notice} from '../ui/components';
import {Chip, vnd} from '../ui/design';
import {Avatar} from '../ui/avatar';
import {isTerminal} from '../driver/contracts/models';
import {driverDate as tripDate} from '../driver/presentation/format';
import {useBooking} from './booking-provider';
import {customerTripStates} from './trip-policy';

export function ActiveTripCard() {
  const {store, state, command} = useBooking(), current = state.current;
  if (!current) return null;
  const presentation = customerTripStates[current.status], terminal = isTerminal(current);
  const assigned = ['ASSIGNED', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED'].includes(current.status);
  return <Card>
    <Chip tone={current.status === 'SEARCHING' || current.status === 'CREATED' ? 'warning' : current.status === 'CANCELLED' ? 'danger' : 'default'}>{presentation.title}</Chip>
    <Notice>{presentation.description}</Notice>
    <ThemedText type="smallBold">{current.fare.finalAmount !== null ? 'Giá chốt chuyến đi' : 'Giá dự kiến'}</ThemedText>
    <ThemedText type="subtitle">{vnd(current.fare.finalAmount ?? current.fare.estimatedAmount)}</ThemedText>
    {current.status === 'COMPLETED' && current.fare.finalAmount === null && <Notice>Chưa có giá chốt từ máy chủ. Số tiền trên là giá dự kiến.</Notice>}
    <Notice>{current.vehicleType === 'CAR_7' ? 'Ô tô 7 chỗ' : current.vehicleType === 'CAR_4' ? 'Ô tô 4 chỗ' : 'Loại xe đang cập nhật'}</Notice>
    {assigned && <View style={{gap: 10}}>
      <View style={{flexDirection: 'row', gap: 14, alignItems: 'center'}}>
        {current.driver?.fullName.trim() && <Avatar name={current.driver.fullName} url={current.driver.avatarUrl}/>}
        <View style={{flex: 1}}><ThemedText type="smallBold">{current.driver?.fullName.trim() || 'Thông tin tài xế đang được cập nhật'}</ThemedText>
          <Notice>Biển số: {current.vehicle?.licensePlate.trim() || 'Chưa có thông tin'}</Notice>
          <Notice>{[current.vehicle?.brand, current.vehicle?.color].filter(Boolean).join(' · ') || 'Thông tin xe đang được cập nhật'}</Notice>
        </View>
      </View>
    </View>}
    <ThemedText>Điểm đón: {current.pickup.address || `${current.pickup.lat}, ${current.pickup.lng}`}</ThemedText>
    <ThemedText>Điểm đến: {current.destination.address || `${current.destination.lat}, ${current.destination.lng}`}</ThemedText>
    {current.status === 'COMPLETED' && <Notice>Hoàn thành: {tripDate(current.timestamps?.completedAt)}</Notice>}
    {current.status === 'CANCELLED' && <>
      <Notice>{current.cancellation ? `${current.cancellation.actorType === 'DRIVER' ? 'Tài xế' : 'Bạn'} đã hủy: ${current.cancellation.reason}` : 'Chưa có thông tin người hủy và lý do từ máy chủ.'}</Notice>
      <Notice>Thời gian hủy: {tripDate(current.cancellation?.cancelledAt ?? current.timestamps?.cancelledAt)}</Notice>
    </>}
    <Action label="Xem chi tiết chuyến" variant="secondary" onPress={() => router.push({pathname: '/customer/trips/[id]', params: {id: current.tripId}})}/>
    {terminal ? <Action label="Đặt chuyến mới" disabled={!store.canStartNewBooking} onPress={store.newBooking}/> :
      ['CREATED', 'SEARCHING', 'ASSIGNED', 'DRIVER_ARRIVED'].includes(current.status) && <Action label="Hủy chuyến · không mất phí" variant="secondary" disabled={!store.cancellationAllowed} onPress={store.requestCancel}/>}
    {state.cancelConfirmation?.tripId === current.tripId && <Card>
      <ThemedText type="smallBold">Bạn muốn hủy chuyến này?</ThemedText>
      <Notice>Không tính phí hủy. Velox sẽ kiểm tra lại vì tài xế có thể bắt đầu chuyến trong lúc bạn xác nhận.</Notice>
      <Action label="Xác nhận hủy chuyến" variant="danger" busy={state.busy || command.busy} disabled={!state.checked || !state.foreground || !!command.pending} onPress={() => {void store.confirmCancel();}}/>
      <Action label="Giữ chuyến đi" variant="secondary" disabled={state.busy || command.busy} onPress={store.dismissCancel}/>
    </Card>}
  </Card>;
}
