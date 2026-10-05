package com.chande.api_gateway.ratelimit;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

@ConfigurationProperties(prefix = "rate-limit.auth")
public record AuthRateLimitProperties(int maxAttempts, Duration window) {

    public AuthRateLimitProperties {
        if (maxAttempts < 1) {
            throw new IllegalStateException("rate-limit.auth.max-attempts phải >= 1");
        }
        if (window == null || window.isZero() || window.isNegative()) {
            throw new IllegalStateException("rate-limit.auth.window phải > 0");
        }
    }
}
