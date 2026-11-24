import { BackendError } from '../backend/http';

// Login and register errors in plain Vietnamese. SERVICE_BUSY is the user service shedding BCrypt work under load
// (503 with Retry-After), so the message tells the rider to wait rather than that the password is wrong.
const messages: Record<string, string> = {
  INVALID_CREDENTIALS: 'Số điện thoại hoặc mật khẩu không đúng.',
  USER_BLOCKED: 'Tài khoản đã bị khóa.',
  PHONE_ALREADY_EXISTS: 'Số điện thoại đã được đăng ký.',
  VALIDATION_ERROR: 'Thông tin chưa hợp lệ, hãy kiểm tra lại.',
  RATE_LIMITED: 'Bạn thử quá nhiều lần. Hãy chờ rồi thử lại.',
  NETWORK_ERROR: 'Không kết nối được máy chủ.',
  TIMEOUT: 'Máy chủ phản hồi quá lâu, hãy thử lại.',
};

export function loginMessage(error: unknown): string {
  if (error instanceof BackendError) {
    if (error.code === 'SERVICE_BUSY') return `Hệ thống đang bận, hãy thử lại sau ${error.retryAfter ?? 1} giây.`;
    return messages[error.code] ?? `Không thể đăng nhập (${error.code}).`;
  }
  return 'Không thể đăng nhập.';
}
