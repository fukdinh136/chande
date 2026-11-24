import {BackendError} from '../backend/http';

const messages: Record<string, string> = {
  INVALID_CREDENTIALS: 'Số điện thoại hoặc mật khẩu chưa đúng.',
  // The user service sheds BCrypt work under load (503 with Retry-After): the password is not the problem.
  SERVICE_BUSY: 'Hệ thống đang bận. Vui lòng thử lại sau giây lát.',
  WRONG_OLD_PASSWORD: 'Mật khẩu hiện tại chưa đúng.',
  NEW_PASSWORD_SAME_AS_OLD: 'Mật khẩu mới phải khác mật khẩu hiện tại.',
  ADDRESS_NOT_FOUND: 'Địa chỉ không còn tồn tại hoặc bạn không được xem.',
  ADDRESS_LIMIT_REACHED: 'Bạn đã lưu tối đa 10 địa chỉ. Hãy sửa hoặc xóa một địa chỉ trước khi thêm.',
  INVALID_PHONE_NUMBER: 'Nhập số điện thoại di động Việt Nam hợp lệ.',
  PHONE_ALREADY_EXISTS: 'Số điện thoại này đã được đăng ký.',
  USER_BLOCKED: 'Tài khoản đã bị khóa. Vui lòng liên hệ đơn vị vận hành.',
  VALIDATION_ERROR: 'Kiểm tra lại thông tin đã nhập.',
  UNAUTHENTICATED: 'Phiên đã hết hạn. Vui lòng đăng nhập lại.',
  INVALID_REFRESH_TOKEN: 'Phiên đã hết hạn. Vui lòng đăng nhập lại.',
  NETWORK_ERROR: 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.',
  BACKEND_NOT_FOUND: 'Chưa kết nối được Velox. Vui lòng thử lại sau.',
  CONFIGURATION_REQUIRED: 'Velox chưa sẵn sàng kết nối. Vui lòng thử lại sau.',
  TIMEOUT: 'Máy chủ phản hồi chậm. Kiểm tra thao tác đang chờ trước khi thử lại.',
  CANCELLED: 'Yêu cầu đã dừng. Vui lòng thử lại.',
  INVALID_RESPONSE: 'Chưa đọc được dữ liệu từ máy chủ. Vui lòng thử lại.',
  QUOTE_EXPIRED: 'Báo giá đã hết hạn. Vui lòng xem giá lại.',
  QUOTE_CLOCK_UNAVAILABLE: 'Chưa xác định được thời gian máy chủ. Vui lòng lấy giá mới.',
  ACTIVE_TRIP_EXISTS: 'Bạn đang có chuyến đi. Vui lòng cập nhật chuyến hiện tại.',
  REQUEST_IN_PROGRESS: 'Thao tác đang được xử lý. Vui lòng kiểm tra lại sau.',
  TRIP_STATE_STALE: 'Dữ liệu mới nhận chưa theo kịp trạng thái đã xác nhận. Velox đang giữ thông tin chuyến gần nhất.',
  TRIP_STATE_UNVERIFIED: 'Chưa xác minh được trạng thái hiện tại. Thông tin chuyến gần nhất vẫn được giữ; hãy kiểm tra lại.',
  VERSION_CONFLICT: 'Chuyến vừa được cập nhật. Hãy kiểm tra trạng thái mới trước khi quyết định tiếp.',
  INVALID_TRANSITION: 'Trạng thái chuyến không còn cho phép thao tác này.',
  QUOTE_ALREADY_USED: 'Báo giá đã được dùng. Hãy kiểm tra chuyến hiện tại trước khi lấy giá mới.',
  IDEMPOTENCY_KEY_REUSED: 'Thao tác đã lưu không khớp yêu cầu trước đó. Vui lòng kiểm tra chuyến trước khi thao tác tiếp.',
};
export function customerError(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (messages[code]) return messages[code];
  const status = error instanceof BackendError ? error.status : 0;
  if (status === 429) return 'Bạn thao tác quá nhanh. Vui lòng chờ rồi thử lại.';
  if (status === 409) return 'Thông tin vừa thay đổi. Vui lòng cập nhật trước khi thao tác tiếp.';
  if (status === 403) return 'Bạn không thể thực hiện thao tác này.';
  if (status === 404) return 'Không tìm thấy thông tin. Vui lòng tải lại.';
  return 'Chưa thực hiện được thao tác. Vui lòng thử lại.';
}
