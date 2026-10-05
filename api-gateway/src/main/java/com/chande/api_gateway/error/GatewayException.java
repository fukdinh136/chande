package com.chande.api_gateway.error;

import java.util.List;

/**
 * Lỗi nghiệp vụ của gateway, được {@link GatewayExceptionResolver} chuyển thành envelope lỗi.
 */
public class GatewayException extends RuntimeException {

    private final ErrorCode code;
    private final List<ErrorDetail> details;
    private final long retryAfterSeconds;

    public GatewayException(ErrorCode code) {
        this(code, List.of(), 0);
    }

    public GatewayException(ErrorCode code, List<ErrorDetail> details) {
        this(code, details, 0);
    }

    public GatewayException(ErrorCode code, long retryAfterSeconds) {
        this(code, List.of(), retryAfterSeconds);
    }

    private GatewayException(ErrorCode code, List<ErrorDetail> details, long retryAfterSeconds) {
        super(code.name(), null, false, false);
        this.code = code;
        this.details = List.copyOf(details);
        this.retryAfterSeconds = retryAfterSeconds;
    }

    public ErrorCode getCode() { return code; }
    public List<ErrorDetail> getDetails() { return details; }
    public long getRetryAfterSeconds() { return retryAfterSeconds; }
}
