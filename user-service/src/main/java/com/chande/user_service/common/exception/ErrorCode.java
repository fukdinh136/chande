package com.chande.user_service.common.exception;

import lombok.Getter;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;

@Getter
@RequiredArgsConstructor
public enum ErrorCode {
    VALIDATION_ERROR(HttpStatus.BAD_REQUEST, "Dữ liệu không hợp lệ"),
    INVALID_PHONE_NUMBER(HttpStatus.BAD_REQUEST, "Số điện thoại không hợp lệ"),
    PHONE_ALREADY_EXISTS(HttpStatus.CONFLICT, "Số điện thoại đã được đăng ký"),
    INVALID_CREDENTIALS(HttpStatus.UNAUTHORIZED, "Số điện thoại hoặc mật khẩu không đúng"),
    USER_BLOCKED(HttpStatus.FORBIDDEN, "Tài khoản đã bị khóa"),
    INVALID_REFRESH_TOKEN(HttpStatus.UNAUTHORIZED, "Phiên đăng nhập không hợp lệ hoặc đã hết hạn"),
    WRONG_OLD_PASSWORD(HttpStatus.BAD_REQUEST, "Mật khẩu cũ không đúng"),
    NEW_PASSWORD_SAME_AS_OLD(HttpStatus.BAD_REQUEST, "Mật khẩu mới phải khác mật khẩu hiện tại"),
    USER_NOT_FOUND(HttpStatus.NOT_FOUND, "Không tìm thấy người dùng"),
    ADDRESS_NOT_FOUND(HttpStatus.NOT_FOUND, "Không tìm thấy địa chỉ"),
    ADDRESS_LIMIT_REACHED(HttpStatus.BAD_REQUEST, "Bạn chỉ được lưu tối đa 10 địa chỉ"),
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "Lỗi hệ thống, vui lòng thử lại sau"),
    ENDPOINT_NOT_FOUND(HttpStatus.NOT_FOUND,"Không tìm thấy API"),
    AUTHENTICATION_REQUIRED(HttpStatus.UNAUTHORIZED, "Bạn cần đăng nhập hoặc token không hợp lệ"),
    ACCESS_DENIED(HttpStatus.FORBIDDEN, "Bạn không có quyền thực hiện thao tác này"),
    METHOD_NOT_ALLOWED(HttpStatus.METHOD_NOT_ALLOWED,"Phương thức HTTP không được hỗ trợ"),
    UNSUPPORTED_MEDIA_TYPE(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "Dữ liệu gửi lên phải ở dạng JSON"),
    NOT_ACCEPTABLE(HttpStatus.NOT_ACCEPTABLE, "API chỉ trả về dữ liệu dạng JSON"),
    DATA_CONFLICT(HttpStatus.CONFLICT, "Dữ liệu vừa bị thay đổi bởi thao tác khác, vui lòng thử lại");


    private final HttpStatus status;
    private final String message;

}