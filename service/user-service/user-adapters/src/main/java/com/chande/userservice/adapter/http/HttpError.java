package com.chande.userservice.adapter.http;

import java.util.Map;
import java.util.Set;

/** Lỗi giao thức do cửa vào HTTP tự ném (404/405/401/403/415/400/413). */
public final class HttpError extends RuntimeException {

    private final int status;
    private final String code;
    private final String errorMessage;
    private final Map<String, String> headers;

    private HttpError(int status, String code, String errorMessage, Map<String, String> headers) {
        super(code, null, false, false);
        this.status = status;
        this.code = code;
        this.errorMessage = errorMessage;
        this.headers = headers;
    }

    private HttpError(int status, String code, String errorMessage) {
        this(status, code, errorMessage, Map.of());
    }

    public static HttpError endpointNotFound() {
        return new HttpError(404, "ENDPOINT_NOT_FOUND", "Không tìm thấy API");
    }

    public static HttpError methodNotAllowed(Set<String> allowed) {
        return new HttpError(405, "METHOD_NOT_ALLOWED", "Phương thức HTTP không được hỗ trợ",
                Map.of("Allow", String.join(", ", allowed)));
    }

    public static HttpError authenticationRequired() {
        return new HttpError(401, "AUTHENTICATION_REQUIRED", "Bạn cần đăng nhập hoặc token không hợp lệ");
    }

    public static HttpError accessDenied() {
        return new HttpError(403, "ACCESS_DENIED", "Bạn không có quyền thực hiện thao tác này");
    }

    public static HttpError unsupportedMediaType() {
        return new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Dữ liệu gửi lên phải ở dạng JSON");
    }

    /** Body rỗng, JSON hỏng hoặc sai kiểu: 400 VALIDATION_ERROR không kèm fieldErrors. */
    public static HttpError invalidBody() {
        return new HttpError(400, "VALIDATION_ERROR", "Dữ liệu không hợp lệ");
    }

    public static HttpError payloadTooLarge() {
        return new HttpError(413, "PAYLOAD_TOO_LARGE", "Dữ liệu gửi lên quá lớn");
    }

    public int status() {
        return status;
    }

    public String code() {
        return code;
    }

    public String errorMessage() {
        return errorMessage;
    }

    public Map<String, String> headers() {
        return headers;
    }
}
