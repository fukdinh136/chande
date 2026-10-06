import { routingErrorText } from '../navigation/providers';
import { RoutingError } from '../navigation/routes';

export class RiderError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 0,
    public readonly serverMessage?: string,
    public readonly fieldErrors?: Record<string, string>,
    public readonly requestId?: string,
  ) {
    super(code);
    this.name = 'RiderError';
  }
}

const messages: Record<string, string> = {
  CONFIGURATION_REQUIRED: 'Chưa cấu hình địa chỉ API Gateway (EXPO_PUBLIC_API_BASE_URL trong .env.local).',
  NETWORK_ERROR: 'Không kết nối được máy chủ. Kiểm tra mạng và địa chỉ API.',
  TIMEOUT: 'Máy chủ phản hồi quá lâu. Vui lòng thử lại.',
  CANCELLED: 'Yêu cầu đã dừng.',
  INVALID_RESPONSE: 'Phản hồi từ máy chủ không đúng định dạng.',
  VALIDATION_ERROR: 'Thông tin chưa hợp lệ. Kiểm tra lại các ô đã nhập.',
  INVALID_REQUEST: 'Yêu cầu chưa hợp lệ.',
  INVALID_PHONE_NUMBER: 'Số điện thoại không hợp lệ.',
  INVALID_CREDENTIALS: 'Số điện thoại hoặc mật khẩu không đúng.',
  PHONE_ALREADY_EXISTS: 'Số điện thoại đã được đăng ký.',
  USER_BLOCKED: 'Tài khoản đã bị khoá.',
  UNAUTHENTICATED: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  AUTHENTICATION_REQUIRED: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  INVALID_REFRESH_TOKEN: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  FORBIDDEN_ACTION: 'Bạn không có quyền thực hiện thao tác này.',
  ACCESS_DENIED: 'Bạn không có quyền thực hiện thao tác này.',
  RATE_LIMITED: 'Bạn thao tác quá nhanh. Vui lòng đợi một chút rồi thử lại.',
  WRONG_OLD_PASSWORD: 'Mật khẩu hiện tại không đúng.',
  NEW_PASSWORD_SAME_AS_OLD: 'Mật khẩu mới phải khác mật khẩu hiện tại.',
  USER_NOT_FOUND: 'Không tìm thấy tài khoản.',
  ADDRESS_LIMIT_REACHED: 'Bạn chỉ lưu được tối đa 10 địa chỉ.',
  ADDRESS_NOT_FOUND: 'Không tìm thấy địa chỉ.',
  DATA_CONFLICT: 'Dữ liệu vừa thay đổi ở nơi khác. Vui lòng thử lại.',
  RESOURCE_NOT_FOUND: 'Không tìm thấy dữ liệu.',
  ACTIVE_TRIP_EXISTS: 'Bạn đang có một chuyến chưa kết thúc.',
  QUOTE_EXPIRED: 'Báo giá đã hết hạn. Đang lấy giá mới.',
  QUOTE_ALREADY_USED: 'Báo giá đã được dùng. Đang lấy giá mới.',
  VERSION_CONFLICT: 'Chuyến vừa thay đổi trạng thái. Đã tải lại thông tin.',
  INVALID_TRANSITION: 'Chuyến không còn ở trạng thái cho phép thao tác này.',
  IDEMPOTENCY_KEY_REUSED: 'Yêu cầu bị trùng khoá. Vui lòng tải lại chuyến.',
  REQUEST_IN_PROGRESS: 'Yêu cầu trước vẫn đang xử lý. Thử lại sau vài giây.',
  INVALID_CURSOR: 'Trang lịch sử không còn hợp lệ. Đang tải lại từ đầu.',
  DEPENDENCY_UNAVAILABLE: 'Dịch vụ tạm thời gián đoạn. Vui lòng thử lại sau.',
  GATEWAY_TIMEOUT: 'Máy chủ phản hồi quá lâu; thao tác có thể đã được xử lý.',
  PAYLOAD_TOO_LARGE: 'Dữ liệu gửi lên quá lớn.',
  LOCATION_DENIED: 'Bạn chưa cấp quyền vị trí cho Chande.',
  LOCATION_UNAVAILABLE: 'Chưa xác định được vị trí hiện tại.',
  GEOCODER_UNAVAILABLE: 'Không tìm được địa điểm. Hãy thử chọn trên bản đồ.',
  STORAGE_UNAVAILABLE: 'Không lưu được phiên đăng nhập trên thiết bị.',
  INTERNAL_ERROR: 'Máy chủ gặp lỗi. Vui lòng thử lại sau.',
};

export function errorText(error: unknown): string {
  if (error instanceof RoutingError) return routingErrorText(error);
  if (!(error instanceof RiderError)) return 'Có lỗi xảy ra. Vui lòng thử lại.';
  // Thông điệp tiếng Việt của User Service chỉ dùng khi app không biết mã lỗi.
  return messages[error.code] ?? error.serverMessage ?? `Máy chủ trả lỗi ${error.code}.`;
}

export function fieldError(error: unknown, field: string): string | null {
  return error instanceof RiderError ? error.fieldErrors?.[field] ?? null : null;
}

export function isRetryable(error: unknown): boolean {
  return error instanceof RiderError && (error.status === 0 || error.status >= 500 || error.status === 429) && error.code !== 'CANCELLED';
}
