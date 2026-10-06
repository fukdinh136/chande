// Định dạng hiển thị tiếng Việt, tự viết để không phụ thuộc dữ liệu Intl của Hermes.
const pad = (value: number) => String(value).padStart(2, '0');

/** Tiền VND là chuỗi số nguyên theo contract Trip, ví dụ "45000" → "45.000 ₫". */
export function formatVnd(amount: string | null | undefined): string {
  if (!amount || !/^\d+$/.test(amount)) return '—';
  return `${amount.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ₫`;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.max(0, Math.round(meters / 10) * 10)} m`;
  const km = meters / 1000;
  return `${(km >= 100 ? Math.round(km).toString() : km.toFixed(1)).replace('.', ',')} km`;
}

export function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} giờ ${rest} phút` : `${hours} giờ`;
}

/** Ví dụ "14:05". */
export function formatTime(iso: string | null | undefined): string {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Ví dụ "06/10/2026 14:05". */
export function formatDateTime(iso: string | null | undefined): string {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Đếm ngược "4:58". */
export function formatCountdown(milliseconds: number): string {
  const total = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(total / 60)}:${pad(total % 60)}`;
}

/** "+84912345678" → "0912 345 678". */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/^\+?84/, '0').replace(/\D/g, '');
  return digits.length === 10 ? `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}` : phone;
}

/** Nhãn ngắn cho toạ độ khi chưa có địa chỉ. */
export const formatCoordinates = (lat: number, lng: number) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

const FARE_LABELS: Record<string, string> = {
  BASE: 'Giá mở cửa', BASE_FARE: 'Giá mở cửa',
  DISTANCE: 'Theo quãng đường', DISTANCE_FARE: 'Theo quãng đường',
  TIME: 'Theo thời gian', TIME_FARE: 'Theo thời gian',
  SURGE: 'Phụ phí cao điểm', DISCOUNT: 'Giảm giá',
};
export const fareLabel = (code: string) => FARE_LABELS[code] ?? code;
