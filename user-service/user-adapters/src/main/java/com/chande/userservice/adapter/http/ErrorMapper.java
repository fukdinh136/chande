package com.chande.userservice.adapter.http;

import com.chande.userservice.domain.common.DomainException;
import com.chande.userservice.domain.common.ErrorCode;
import com.chande.userservice.domain.common.ValidationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Mọi exception đi qua đây để thành response lỗi. Lỗi 5xx không lộ chi tiết; stack trace chỉ ghi vào log. */
final class ErrorMapper {

    private static final Logger log = LoggerFactory.getLogger(ErrorMapper.class);

    private ErrorMapper() {
    }

    static HttpResult toResult(Throwable error) {
        return switch (error) {
            case ValidationException e ->
                    HttpResult.of(400, new ErrorJson(e.code().name(), e.code().message(), e.fieldErrors()));
            case DomainException e ->
                    HttpResult.of(status(e.code()), new ErrorJson(e.code().name(), e.code().message(), null));
            case HttpError e -> {
                HttpResult result = HttpResult.of(e.status(), new ErrorJson(e.code(), e.errorMessage(), null));
                for (var header : e.headers().entrySet()) {
                    result = result.withHeader(header.getKey(), header.getValue());
                }
                yield result;
            }
            default -> {
                log.error("Unexpected error", error);
                yield HttpResult.of(500, new ErrorJson("INTERNAL_ERROR", "Lỗi hệ thống, vui lòng thử lại sau", null));
            }
        };
    }

    /** Bảng ErrorCode -> HTTP status nằm ở adapter, không nằm ở domain. */
    static int status(ErrorCode code) {
        return switch (code) {
            case VALIDATION_ERROR, INVALID_PHONE_NUMBER, ADDRESS_LIMIT_REACHED, WRONG_OLD_PASSWORD,
                 NEW_PASSWORD_SAME_AS_OLD -> 400;
            case INVALID_CREDENTIALS, INVALID_REFRESH_TOKEN -> 401;
            case USER_BLOCKED -> 403;
            case USER_NOT_FOUND, ADDRESS_NOT_FOUND -> 404;
            case PHONE_ALREADY_EXISTS, DATA_CONFLICT -> 409;
        };
    }
}
