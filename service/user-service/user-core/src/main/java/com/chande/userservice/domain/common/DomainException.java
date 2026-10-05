package com.chande.userservice.domain.common;

/** Lỗi nghiệp vụ có mã. Không mang stack trace vì đây là luồng bình thường, không phải sự cố. */
public class DomainException extends RuntimeException {

    private final ErrorCode code;

    public DomainException(ErrorCode code) {
        super(code.name(), null, false, false);
        this.code = code;
    }

    public ErrorCode code() {
        return code;
    }
}
