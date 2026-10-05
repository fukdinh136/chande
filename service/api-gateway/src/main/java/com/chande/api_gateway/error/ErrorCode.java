package com.chande.api_gateway.error;

import org.springframework.http.HttpStatus;

/**
 * Mã lỗi do chính gateway trả về. Dùng lại tên mã trong tài liệu API của các service
 * (UNAUTHENTICATED, FORBIDDEN_ACTION, RATE_LIMITED, ...) để app chỉ cần xử lý một bộ mã.
 * ENDPOINT_NOT_FOUND, PAYLOAD_TOO_LARGE và GATEWAY_TIMEOUT là mã riêng của gateway.
 */
public enum ErrorCode {
    INVALID_REQUEST(HttpStatus.BAD_REQUEST, "Yêu cầu không hợp lệ"),
    UNAUTHENTICATED(HttpStatus.UNAUTHORIZED, "Bạn cần đăng nhập hoặc token không hợp lệ"),
    INVALID_SERVICE_CREDENTIAL(HttpStatus.UNAUTHORIZED, "Thông tin xác thực dịch vụ không hợp lệ"),
    FORBIDDEN_ACTION(HttpStatus.FORBIDDEN, "Bạn không có quyền thực hiện thao tác này"),
    ENDPOINT_NOT_FOUND(HttpStatus.NOT_FOUND, "Không tìm thấy API được yêu cầu"),
    EVENT_ID_REUSED(HttpStatus.CONFLICT, "eventId đã được dùng cho một sự kiện có nội dung khác"),
    PAYLOAD_TOO_LARGE(HttpStatus.CONTENT_TOO_LARGE, "Dữ liệu gửi lên quá lớn"),
    RATE_LIMITED(HttpStatus.TOO_MANY_REQUESTS, "Bạn thao tác quá nhiều lần, vui lòng thử lại sau"),
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "Đã có lỗi xảy ra, vui lòng thử lại sau"),
    DEPENDENCY_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "Dịch vụ tạm thời không khả dụng, vui lòng thử lại sau"),
    GATEWAY_TIMEOUT(HttpStatus.GATEWAY_TIMEOUT, "Dịch vụ phản hồi quá lâu, vui lòng thử lại sau");

    private final HttpStatus status;
    private final String message;

    ErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }

    public HttpStatus getStatus() { return status; }
    public String getMessage() { return message; }
}
