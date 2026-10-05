export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 0,
    public readonly requestId?: string,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}
const messages: Record<string, string> = {
  CONFIGURATION_REQUIRED: 'Cần cấu hình địa chỉ Driver trong .env.local.',
  TRIP_NOT_CONFIGURED: 'Trip chưa được cấu hình hoặc chưa xác nhận JWT trust.',
  GATEWAY_NOT_CONFIRMED: 'Chưa xác nhận URL và contract Gateway chính thức.',
  INVALID_ROUTE: 'Đường dẫn API chưa hợp lệ. Kiểm tra cấu hình client.',
  NETWORK_ERROR: 'Không kết nối được dịch vụ. Kiểm tra mạng và địa chỉ API.',
  TIMEOUT: 'Dịch vụ phản hồi quá lâu. Thao tác có thể đã được xử lý.',
  CANCELLED: 'Yêu cầu đã dừng.',
  INVALID_RESPONSE: 'Phản hồi không khớp contract. Cần kiểm tra service.',
  UNAUTHENTICATED: 'Phiên đã hết hạn. Vui lòng đăng nhập lại.',
  INVALID_REFRESH_TOKEN: 'Phiên không còn hợp lệ. Vui lòng đăng nhập lại.',
  AUTHENTICATION_FAILED: 'Không xác thực được tài khoản thử nghiệm.',
  INVALID_OTP: 'OTP không đúng hoặc đã hết hạn. Kiểm tra lại mã.',
  OTP_EXPIRED: 'OTP đã hết hạn. Hãy yêu cầu mã mới.',
  INVALID_REQUEST: 'Thông tin chưa hợp lệ. Kiểm tra các trường nhập.',
  RATE_LIMITED: 'Bạn thao tác quá nhanh. Hãy chờ rồi thử lại.',
  RESOURCE_NOT_FOUND: 'Không tìm thấy dữ liệu hoặc bạn không có quyền truy cập.',
  FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  FORBIDDEN_ACTION: 'Bạn không có quyền thực hiện thao tác này.',
  INVALID_CURSOR: 'Trang lịch sử không còn hợp lệ. Hãy tải lại trang đầu.',
  VEHICLE_ACTIVE_CONSTRAINT: 'Cấu hình xe hoạt động vi phạm ràng buộc dữ liệu hiện có. Cần kiểm tra với người quản lý schema.',
  CRYPTO_UNAVAILABLE: 'Không tạo được khóa lệnh an toàn. Kiểm tra dependency Expo Crypto và môi trường chạy.',
  DRIVER_STATUS_MIGRATION_REQUIRED: 'Dữ liệu trạng thái tài xế chưa được chuyển đổi. Liên hệ người quản lý dữ liệu.',
  VEHICLE_REQUIRED: 'Hãy chọn xe đang hoạt động trước khi bật nhận cuốc.',
  VEHICLE_INACTIVE: 'Xe đã ngừng hoạt động. Hãy chọn xe khác.',
  PROFILE_INCOMPLETE: 'Cần hoàn thiện họ tên và giấy phép lái xe.',
  DRIVER_MUST_BE_OFFLINE: 'Hãy tắt nhận cuốc trước khi đổi thông tin này.',
  DRIVER_HAS_ACTIVE_TRIP: 'Đang có chuyến. Hãy hoàn tất chuyến trước khi đổi xe hoặc giấy phép.',
  LICENSE_PLATE_CONFLICT: 'Biển số đã được đăng ký.',
  LICENSE_NUMBER_CONFLICT: 'Giấy phép lái xe đã được đăng ký.',
  VEHICLE_LIMIT_REACHED: 'Đã đạt giới hạn số xe.',
  DEPENDENCY_UNAVAILABLE: 'Dịch vụ phụ thuộc chưa sẵn sàng. Kiểm tra Trip hoặc Redis.',
  VERSION_CONFLICT: 'Chuyến đã thay đổi. Đang tải lại; hãy xem trạng thái mới trước khi thao tác.',
  INVALID_TRANSITION: 'Không thể chuyển trạng thái này. Hãy tải lại chuyến.',
  IDEMPOTENCY_KEY_REUSED: 'Lệnh đã có nội dung khác với khóa này. Cần kiểm tra trạng thái chuyến.',
  REQUEST_IN_PROGRESS: 'Lệnh trước vẫn đang được xử lý. Thử lại cùng lệnh sau ít giây.',
  STORAGE_UNAVAILABLE: 'Không lưu được phiên an toàn trên thiết bị. Vui lòng thử đăng nhập lại.',
};
export function errorText(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Có lỗi xảy ra. Vui lòng thử lại.';
  const message = messages[error.code] ?? `Dịch vụ trả lỗi ${error.code}.`;
  return error.requestId ? `${message} Mã yêu cầu: ${error.requestId}` : message;
}
export function isRetryable(error: unknown) {
  return error instanceof ApiError && (
    error.status === 0 || error.status >= 500 || error.status === 429
  ) && !['CANCELLED', 'STORAGE_UNAVAILABLE', 'TRIP_NOT_CONFIGURED'].includes(error.code);
}
