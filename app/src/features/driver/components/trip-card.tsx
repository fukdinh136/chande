import { ThemedText } from '@/components/themed-text';
import type { Trip } from '../contracts/models';
import { Card, Notice } from './ui';
import { actorLabels, driverDate, shortId, tripLabels, vehicleLabel } from '../presentation/format';
import { vnd } from '../../ui/design';

export { tripLabels } from '../presentation/format';
export function TripCard({ trip }: { trip: Trip }) {
  return (
    <Card>
      <ThemedText type="smallBold">{tripLabels[trip.status]}</ThemedText>
      <Notice>Chuyến #{shortId(trip.tripId)} · Yêu cầu lúc {driverDate(trip.timestamps?.requestedAt)}</Notice>
      {trip.status === 'COMPLETED' && <Notice>Hoàn thành lúc {driverDate(trip.timestamps?.completedAt)}</Notice>}
      {trip.status === 'CANCELLED' && <Notice>Hủy lúc {driverDate(trip.timestamps?.cancelledAt)}</Notice>}
      <ThemedText>Đón: {trip.pickup.address ?? `${trip.pickup.lat}, ${trip.pickup.lng}`}</ThemedText>
      <ThemedText>Đến: {trip.destination.address ?? `${trip.destination.lat}, ${trip.destination.lng}`}</ThemedText>
      <Notice>{vehicleLabel(trip.vehicleType)} · {trip.fare.finalAmount === null ? 'Giá dự kiến' : 'Giá chốt'}: {vnd(trip.fare.finalAmount ?? trip.fare.estimatedAmount)}</Notice>
      {trip.status === 'CANCELLED' && <Notice>{trip.cancellation ? `${actorLabels[trip.cancellation.actorType]} hủy: ${trip.cancellation.reason}` : 'Chưa có thông tin lý do hủy.'}</Notice>}
    </Card>
  );
}
