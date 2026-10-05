package com.chande.userservice.domain.common;

/**
 * Mã lỗi nghiệp vụ. Không biết HTTP status: bảng ErrorCode -> status nằm ở adapter HTTP.
 * Message tiếng Việt giữ nguyên như v1.
 */
public enum ErrorCode {
    VALIDATION_ERROR("Dữ liệu không hợp lệ"),
    INVALID_PHONE_NUMBER("Số điện thoại không hợp lệ"),
    PHONE_ALREADY_EXISTS("Số điện thoại đã được đăng ký"),
    INVALID_CREDENTIALS("Số điện thoại hoặc mật khẩu không đúng"),
    USER_BLOCKED("Tài khoản đã bị khóa"),
    INVALID_REFRESH_TOKEN("Phiên đăng nhập không hợp lệ hoặc đã hết hạn"),
    WRONG_OLD_PASSWORD("Mật khẩu cũ không đúng"),
    NEW_PASSWORD_SAME_AS_OLD("Mật khẩu mới phải khác mật khẩu hiện tại"),
    USER_NOT_FOUND("Không tìm thấy người dùng"),
    ADDRESS_NOT_FOUND("Không tìm thấy địa chỉ"),
    ADDRESS_LIMIT_REACHED("Bạn chỉ được lưu tối đa 10 địa chỉ"),
    DATA_CONFLICT("Dữ liệu vừa bị thay đổi bởi thao tác khác, vui lòng thử lại");

    private final String message;

    ErrorCode(String message) {
        this.message = message;
    }

    public String message() {
        return message;
    }
}
