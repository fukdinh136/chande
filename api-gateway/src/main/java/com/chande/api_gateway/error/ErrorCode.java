package com.chande.api_gateway.error;

import org.springframework.http.HttpStatus;

public enum ErrorCode {
    AUTHENTICATION_REQUIRED(HttpStatus.UNAUTHORIZED, "Bạn cần đăng nhập hoặc token không hợp lệ"),
    ACCESS_DENIED(HttpStatus.FORBIDDEN, "Bạn không có quyền thực hiện thao tác này"),
    ENDPOINT_NOT_FOUND(HttpStatus.NOT_FOUND, "Không tìm thấy API được yêu cầu"),
    TOO_MANY_REQUESTS(HttpStatus.TOO_MANY_REQUESTS, "Bạn thao tác quá nhiều lần, vui lòng thử lại sau"),
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "Đã có lỗi xảy ra, vui lòng thử lại sau"),
    SERVICE_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "Dịch vụ tạm thời không khả dụng, vui lòng thử lại sau"),
    GATEWAY_TIMEOUT(HttpStatus.GATEWAY_TIMEOUT, "Dịch vụ phản hồi quá lâu, vui lòng thử lại sau");

    private final HttpStatus status;
    private final String message;
    private final String json;

    ErrorCode(HttpStatus status, String message) {
        if (message.contains("\"") || message.contains("\\")) {
            throw new IllegalArgumentException("message không được chứa dấu \" hoặc \\");
        }
        this.status = status;
        this.message = message;
        this.json = "{\"code\":\"" + name() + "\",\"message\":\"" + message + "\"}";
    }

    public HttpStatus getStatus() { return status; }
    public String getMessage() { return message; }
    public String toJson() { return json; }
}