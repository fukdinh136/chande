import {BackendError} from '../backend/http';
import {isTerminal, noDriverFound, type Trip, type TripStatus} from '../driver/contracts/models';

export const customerTripStates: Record<TripStatus, {title: string; description: string}> = {
  CREATED: {title: 'Đã ghi nhận yêu cầu', description: 'Velox đang xử lý yêu cầu đặt xe của bạn.'},
  SEARCHING: {title: 'Đang tìm tài xế', description: 'Velox đang tìm tài xế phù hợp. Bạn có thể hủy trước khi hành trình bắt đầu.'},
  ASSIGNED: {title: 'Đã có tài xế', description: 'Tài xế đã được gán cho chuyến. Bạn hãy kiểm tra thông tin xe và điểm đón.'},
  DRIVER_ARRIVED: {title: 'Tài xế đã đến điểm đón', description: 'Bạn hãy đến đúng điểm đón đã chọn để bắt đầu hành trình.'},
  IN_PROGRESS: {title: 'Đang trong hành trình', description: 'Chúc bạn có chuyến đi thuận lợi. Chuyến đang diễn ra không thể hủy.'},
  COMPLETED: {title: 'Hành trình đã hoàn thành', description: 'Cảm ơn bạn đã đồng hành cùng Velox.'},
  CANCELLED: {title: 'Chuyến đi đã hủy', description: 'Chuyến đi đã kết thúc. Velox không tự đặt lại chuyến khác.'},
};
// ADR-0004: the search ended at its deadline with no driver and the system cancelled the trip.
const noDriver = {title: 'Không tìm thấy tài xế', description: 'Chưa có tài xế nhận chuyến trong thời gian tìm nên chuyến đã được hủy, bạn không mất phí. Bạn có thể đặt lại chuyến.'};
/** Title and description for a trip, with the no-driver cancellation told apart from a cancellation by a person. */
export function tripPresentation(trip: Trip) {
  return noDriverFound(trip) ? noDriver : customerTripStates[trip.status];
}
/** Who cancelled and why, in words; never the raw reason code of a system cancellation. */
export function cancellationText(trip: Trip) {
  const cancellation = trip.cancellation;
  if (!cancellation) return 'Chưa có thông tin người hủy và lý do từ máy chủ.';
  if (cancellation.actorType === 'SYSTEM') return noDriverFound(trip) ? 'Hệ thống đã hủy vì không tìm thấy tài xế.' : `Hệ thống đã hủy: ${cancellation.reason}`;
  return `${cancellation.actorType === 'DRIVER' ? 'Tài xế' : 'Bạn'} đã hủy: ${cancellation.reason}`;
}
export function canCancelTrip(value: Trip | null) {
  return !!value && value.version >= 1 && ['CREATED', 'SEARCHING', 'ASSIGNED', 'DRIVER_ARRIVED'].includes(value.status);
}
export function latestTrip(previous: Trip | null, incoming: Trip) {
  if (previous?.tripId !== incoming.tripId) return incoming;
  if (previous.version > incoming.version || isTerminal(previous) && !isTerminal(incoming)) throw new BackendError('TRIP_STATE_STALE');
  if (previous.version === incoming.version && previous.status !== incoming.status) throw new BackendError('INVALID_RESPONSE');
  return incoming;
}
export function definitiveCommandFailure(error: unknown) {
  const value = error as {status?: number; code?: string} | null;
  return !!value?.status && value.status >= 400 && value.status < 500 && ![408, 429].includes(value.status) && value.code !== 'REQUEST_IN_PROGRESS';
}
