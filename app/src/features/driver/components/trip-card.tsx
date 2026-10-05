import { ThemedText } from '@/components/themed-text';
import type { Trip } from '../contracts/models';
import { Card, Notice } from './ui';

const labels = {
  CREATED: 'Đã tạo', SEARCHING: 'Đang tìm tài xế', ASSIGNED: 'Đã được giao chuyến',
  DRIVER_ARRIVED: 'Đã đến điểm đón', IN_PROGRESS: 'Đang đi', COMPLETED: 'Đã hoàn thành', CANCELLED: 'Đã hủy',
};
export function TripCard({ trip }: { trip: Trip }) {
  return (
    <Card>
      <ThemedText>{labels[trip.status]}</ThemedText>
      <Notice>{trip.tripId} · phiên bản {trip.version}</Notice>
      <ThemedText>Đón: {trip.pickup.address ?? `${trip.pickup.lat}, ${trip.pickup.lng}`}</ThemedText>
      <ThemedText>Đến: {trip.destination.address ?? `${trip.destination.lat}, ${trip.destination.lng}`}</ThemedText>
      <Notice>{trip.vehicleType} · {trip.fare.finalAmount ?? trip.fare.estimatedAmount} {trip.fare.currency}</Notice>
    </Card>
  );
}
