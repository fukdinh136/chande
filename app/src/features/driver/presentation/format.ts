import type { Availability, TripStatus } from '../contracts/models';

export const vehicleTypes = { BIKE: 'Xe máy', CAR_4: 'Ô tô 4 chỗ', CAR_7: 'Ô tô 7 chỗ' };
export function vehicleLabel(type: string | null | undefined) {
  return type && Object.hasOwn(vehicleTypes, type) ? vehicleTypes[type as keyof typeof vehicleTypes] : type ? `Loại xe chưa nhận diện (${type})` : 'Chưa có loại xe';
}
export const tripLabels: Record<TripStatus, string> = {
  CREATED: 'Đã tạo', SEARCHING: 'Đang tìm tài xế', ASSIGNED: 'Đã được giao chuyến',
  DRIVER_ARRIVED: 'Đã đến điểm đón', IN_PROGRESS: 'Đang đi', COMPLETED: 'Đã hoàn thành', CANCELLED: 'Đã hủy',
};
export const actorLabels = { RIDER: 'Khách hàng', DRIVER: 'Tài xế', SYSTEM: 'Hệ thống' };
export function shortId(id: string) { return id.slice(0, 8).toUpperCase(); }
// Every Driver date uses the same explicit timezone, independent of device settings.
const dateFormat = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function driverDate(value: string | null | undefined) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? `${dateFormat.format(date)} (giờ VN)` : 'Chưa có dữ liệu';
}
export function availabilityLabel(value: Availability | undefined, loading: boolean, error: unknown) {
  if (!value) return loading || !error ? 'Đang kiểm tra nhận cuốc…' : 'Chưa xác định trạng thái nhận cuốc';
  if (error) return 'Chưa xác nhận được trạng thái mới nhất';
  return value.desiredStatus === 'ONLINE' ? 'Đã bật nhận cuốc' : 'Đã tắt nhận cuốc';
}
export const operationalLabels: Record<Availability['realtimeStatus'], string> = {
  AVAILABLE: 'Hệ thống đang ghi nhận sẵn sàng', BUSY: 'Hệ thống đang ghi nhận bận', OFFLINE: 'Hệ thống đang ghi nhận ngoại tuyến', UNKNOWN: 'Chưa xác định khả năng nhận chuyến',
};
