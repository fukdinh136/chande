import { ThemedText } from '@/components/themed-text';
import type { Trip } from '../contracts/models';
import { Card, Notice } from './ui';

export const tripLabels = {
  CREATED: 'Đã tạo', SEARCHING: 'Đang tìm tài xế', ASSIGNED: 'Đã được giao chuyến',
  DRIVER_ARRIVED: 'Đã đến điểm đón', IN_PROGRESS: 'Đang đi', COMPLETED: 'Đã hoàn thành', CANCELLED: 'Đã hủy',
};
export function TripCard({ trip }: { trip: Trip }) {
  return (
    <Card>
      <ThemedText type="smallBold">{tripLabels[trip.status]}</ThemedText>
      <ThemedText>Đón: {trip.pickup.address ?? `${trip.pickup.lat}, ${trip.pickup.lng}`}</ThemedText>
      <ThemedText>Đến: {trip.destination.address ?? `${trip.destination.lat}, ${trip.destination.lng}`}</ThemedText>
      <Notice>{trip.vehicleType==='CAR_7'?'Ô tô 7 chỗ':'Ô tô 4 chỗ'} · {(trip.fare.finalAmount??trip.fare.estimatedAmount).replace(/\B(?=(\d{3})+(?!\d))/g,'.')} ₫</Notice>
    </Card>
  );
}
