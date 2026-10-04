package com.chande.user_service.common.exception;

import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.HttpMediaTypeNotAcceptableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import org.springframework.security.core.AuthenticationException;
import org.springframework.security.access.AccessDeniedException;
import java.util.LinkedHashMap;
import java.util.Map;

@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ApiErrorResponse> handleTypeMismatch(MethodArgumentTypeMismatchException ex) {
        log.warn("Invalid value for parameter '{}'", ex.getName());
        return build(ErrorCode.VALIDATION_ERROR, Map.of(ex.getName(), "Giá trị không hợp lệ"));
    }

    // 1. Lỗi nghiệp vụ do service chủ động ném: throw new ApiException(ErrorCode.XXX)
    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ApiErrorResponse> handleApiException(ApiException ex) {
        log.warn("Business error: {}", ex.getErrorCode());
        return build(ex.getErrorCode());
    }

    // 2. DTO có @Valid bị sai quy tắc (@NotBlank, @Pattern, @Size...) -> gom lỗi theo từng ô nhập
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiErrorResponse> handleValidation(MethodArgumentNotValidException ex) {
        Map<String, String> errors = new LinkedHashMap<>();   // Giữ đúng thứ tự các ô
        for (FieldError fe : ex.getBindingResult().getFieldErrors()) {
            // 1 ô có thể vi phạm nhiều quy tắc -> chỉ giữ lỗi đầu tiên
            errors.putIfAbsent(fe.getField(), fe.getDefaultMessage());
        }
        log.warn("Validation error: {}", errors);
        return build(ErrorCode.VALIDATION_ERROR, errors);
    }

    // 3. Body không đọc được: JSON sai cú pháp, thiếu body, sai kiểu dữ liệu
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiErrorResponse> handleUnreadableBody(HttpMessageNotReadableException ex) {
        log.warn("Unreadable request body: {}", ex.getMessage());
        return build(ErrorCode.VALIDATION_ERROR);
    }

    // 4. Gọi sai đường dẫn, ví dụ /api/v1/userz
    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ApiErrorResponse> handleNotFound(NoResourceFoundException ex) {
        log.warn("Endpoint not found: {}", ex.getResourcePath());
        return build(ErrorCode.ENDPOINT_NOT_FOUND);
    }

    // 5. Sai phương thức HTTP, ví dụ GET vào API chỉ nhận POST
    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ApiErrorResponse> handleMethodNotAllowed(HttpRequestMethodNotSupportedException ex) {
        log.warn("Method not allowed: {}", ex.getMethod());
        return build(ErrorCode.METHOD_NOT_ALLOWED);
    }

    // 5a. Sai Content-Type, ví dụ gửi text/plain hoặc quên header Content-Type cho API nhận JSON
    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<ApiErrorResponse> handleUnsupportedMediaType(HttpMediaTypeNotSupportedException ex) {
        log.warn("Unsupported content type: {}", ex.getContentType());
        return build(ErrorCode.UNSUPPORTED_MEDIA_TYPE);
    }

    // 5b. Client đòi định dạng server không có, ví dụ Accept: application/xml
    @ExceptionHandler(HttpMediaTypeNotAcceptableException.class)
    public ResponseEntity<ApiErrorResponse> handleNotAcceptable(HttpMediaTypeNotAcceptableException ex) {
        log.warn("Not acceptable: {}", ex.getMessage());
        return build(ErrorCode.NOT_ACCEPTABLE);
    }

    // 5c. Vi phạm ràng buộc DB (UNIQUE, partial unique index...) khi 2 request ghi cùng lúc
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ApiErrorResponse> handleDataIntegrity(DataIntegrityViolationException ex) {
        log.warn("Data integrity violation: {}", ex.getMostSpecificCause().getMessage());
        return build(ErrorCode.DATA_CONFLICT);
    }

    // 6. Mọi lỗi còn lại (lỗi thật của hệ thống): ghi ĐỦ stack trace vào log,
    //    nhưng KHÔNG gửi chi tiết lỗi cho client (tránh lộ thông tin nội bộ)
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiErrorResponse> handleUnexpected(Exception ex) {
        log.error("Unexpected error", ex);
        return build(ErrorCode.INTERNAL_ERROR);
    }

    // Hàm phụ: tạo response từ ErrorCode, dùng chung cho các handler ở trên.
    // Đặt sẵn Content-Type JSON: lỗi luôn trả JSON kể cả khi client gửi Accept khác
    // (nếu không, Spring không ghi được body → lỗi chồng lỗi → rơi xuống /error).
    private ResponseEntity<ApiErrorResponse> build(ErrorCode errorCode) {
        return build(errorCode, null);
    }

    private ResponseEntity<ApiErrorResponse> build(ErrorCode errorCode, Map<String, String> fieldErrors) {
        return ResponseEntity
                .status(errorCode.getStatus())
                .contentType(MediaType.APPLICATION_JSON)
                .body(ApiErrorResponse.of(errorCode, fieldErrors));
    }

    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<ApiErrorResponse> handleAuthentication(AuthenticationException ex) {
        log.warn("Authentication failed: {}", ex.getMessage());
        return build(ErrorCode.AUTHENTICATION_REQUIRED);
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ApiErrorResponse> handleAccessDenied(AccessDeniedException ex) {
        log.warn("Access denied: {}", ex.getMessage());
        return build(ErrorCode.ACCESS_DENIED);
    }
}