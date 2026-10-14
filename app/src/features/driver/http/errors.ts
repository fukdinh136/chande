export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 0,
    public readonly requestId?: string,
    public readonly retryAt: number | null = null,
    public readonly context?: 'otp-request' | 'otp-verify' | 'refresh' | 'logout',
  ) {
    super(code);
    this.name = 'ApiError';
  }
}
const messages: Record<string, string> = {
  CONFIGURATION_REQUIRED: 'Cần cấu hình địa chỉ Driver trong .env.local.',
  TRIP_NOT_CONFIGURED: 'Trip chưa được cấu hình hoặc chưa xác nhận JWT trust.',
  MATCHING_NOT_CONFIGURED: 'Chưa cấu hình Matching. Không thể đọc hoặc quyết định lời mời.',
  ROUTING_NOT_CONFIGURED: 'Chưa cấu hình public Gateway cho điều hướng.',
  REALTIME_NOT_CONFIGURED: 'Chưa cấu hình Realtime Socket.IO cho GPS và thông báo lời mời.',
  GATEWAY_NOT_CONFIRMED: 'Chưa xác nhận URL và contract Gateway chính thức.',
  INVALID_ROUTE: 'Đường dẫn API chưa hợp lệ. Kiểm tra cấu hình client.',
  NETWORK_ERROR: 'Không kết nối được dịch vụ. Kiểm tra mạng và địa chỉ API.',
  BACKEND_NOT_FOUND: 'Chưa tìm thấy Gateway local. Kiểm tra mạng và origin public đã triển khai, rồi thử kết nối lại.',
  TIMEOUT: 'Dịch vụ phản hồi quá lâu. Thao tác có thể đã được xử lý.',
  CANCELLED: 'Yêu cầu đã dừng.',
  INVALID_RESPONSE: 'Phản hồi không khớp contract. Cần kiểm tra service.',
  UNAUTHENTICATED: 'Dịch vụ chưa chấp nhận thông tin xác thực. Hãy kiểm tra phiên hoặc cấu hình kết nối.',
  INVALID_REFRESH_TOKEN: 'Phiên không còn hợp lệ. Vui lòng đăng nhập lại.',
  AUTHENTICATION_FAILED: 'Không xác thực được thông tin đăng nhập.',
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
  VEHICLE_CREATE_PENDING: 'Yêu cầu tạo xe trước đang gửi hoặc chưa rõ kết quả. Hãy kiểm tra danh sách và biển số trước khi tạo tiếp.',
  DEPENDENCY_UNAVAILABLE: 'Dịch vụ phụ thuộc chưa sẵn sàng. Kiểm tra Trip hoặc Redis.',
  VERSION_CONFLICT: 'Chuyến đã thay đổi. Đang tải lại; hãy xem trạng thái mới trước khi thao tác.',
  INVALID_TRANSITION: 'Không thể chuyển trạng thái này. Hãy tải lại chuyến.',
  IDEMPOTENCY_KEY_REUSED: 'Lệnh đã có nội dung khác với khóa này. Cần kiểm tra trạng thái chuyến.',
  REQUEST_IN_PROGRESS: 'Lệnh trước vẫn đang được xử lý. Thử lại cùng lệnh sau ít giây.',
  OFFER_CLOSED: 'Lời mời không còn cho phép quyết định. Đang đối soát với Matching.',
  IDEMPOTENCY_CONFLICT: 'Khóa quyết định đã có nội dung khác. Chỉ đối soát server; không thay khóa hoặc payload.',
  NOT_FOUND: 'Matching không tìm thấy lời mời. Chưa thể kết luận kết quả quyết định.',
  OFFER_COMMAND_SCOPE: 'Quyết định không khớp tài xế hoặc môi trường hiện tại. Không gửi lại; cần đối soát.',
  OFFER_STORAGE_INVALID: 'Dữ liệu quyết định lưu trên thiết bị không hợp lệ. Đã khóa thao tác để tránh gửi trùng.',
  COMMAND_STORAGE_INVALID: 'Lệnh chuyến lưu trên thiết bị không hợp lệ. Đã khóa lệnh mới; cần kiểm tra dữ liệu trước khi tiếp tục.',
  COMMAND_SCOPE_MISMATCH: 'Lệnh cũ thiếu endpoint cố định trong khi route đã được tùy chỉnh. Không gửi lại; cần đối soát chuyến hoặc khôi phục cấu hình route cũ.',
  STORAGE_UNAVAILABLE: 'Không đọc hoặc lưu được dữ liệu an toàn trên thiết bị. Hãy thử lại thao tác lưu trữ.',
  CREDENTIAL_STORAGE_INVALID: 'Dữ liệu phiên lưu trên thiết bị không hợp lệ. Hãy đăng xuất để xóa dữ liệu phiên, rồi đăng nhập bằng OTP.',
  ACCESS_TOKEN_EXPIRED: 'Phiên hiện tại đã hết thời gian sử dụng. Hãy thử phục hồi kết nối để tiếp tục.',
  REFRESH_UNCERTAIN: 'Chưa xác nhận được phiên đã lưu. Hãy đăng nhập bằng OTP để tiếp tục an toàn.',
  SESSION_UNAVAILABLE: 'Phiên tạm thời chưa sử dụng được. Hãy xử lý kết nối hoặc lưu trữ phiên.',
  CREDENTIAL_SAVE_FAILED: 'Đã nhận phiên mới nhưng chưa lưu được an toàn. Hãy thử lưu lại để tiếp tục.',
  CREDENTIAL_CLEAR_FAILED: 'Chưa xóa được phiên đã lưu trên thiết bị. Phiên trong ứng dụng đã dừng; hãy thử xóa lại.',
  DRIVER_AUTH_REJECTED: 'Dịch vụ Driver chưa chấp nhận phiên mới. Hãy kiểm tra cấu hình xác thực hoặc đăng nhập lại bằng OTP.',
};
export function errorText(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Có lỗi xảy ra. Vui lòng thử lại.';
  let message = messages[error.code] ?? `Dịch vụ trả lỗi ${error.code}.`;
  if (error.context === 'otp-verify' && error.code === 'AUTHENTICATION_FAILED') message = 'Không xác thực được OTP hoặc thông tin đăng nhập. Mã có thể sai, hết hạn hoặc đã dùng; kiểm tra thông tin hoặc yêu cầu mã mới.';
  if (error.context === 'otp-request' && error.code === 'AUTHENTICATION_FAILED') message = 'Không thể yêu cầu OTP với thông tin hiện tại. Kiểm tra thông tin đăng nhập.';
  if (error.context && error.code === 'DEPENDENCY_UNAVAILABLE') message = 'Dịch vụ xác thực tạm thời chưa sẵn sàng. Hãy chờ rồi thử lại.';
  if (error.context === 'logout' && (['NETWORK_ERROR', 'TIMEOUT'].includes(error.code) || error.status >= 500)) message = 'Đã đăng xuất trên thiết bị. Chưa xác nhận thu hồi phiên trên máy chủ do lỗi kết nối; phiên local vẫn được đóng.';
  if (error.code === 'RATE_LIMITED' && error.retryAt === null) message += ' Server chưa cung cấp thời gian chờ; hãy chờ rồi thử lại.';
  return error.requestId ? `${message} Mã yêu cầu: ${error.requestId}` : message;
}
// Writes without idempotency need an authoritative read after an ambiguous result.
export function writeUncertain(error: unknown) {
  return error instanceof ApiError && (['NETWORK_ERROR', 'TIMEOUT', 'CANCELLED', 'INVALID_RESPONSE'].includes(error.code) || error.status >= 500);
}
