package com.chande.api_gateway.ratelimit;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

@ConfigurationProperties(prefix = "rate-limit.login")
public record LoginRateLimitProperties(int maxAttempts, Duration window) {

    public LoginRateLimitProperties {
        if (maxAttempts < 1) {
            throw new IllegalStateException("rate-limit.login.max-attempts phải >= 1");
        }
        if (window == null || window.isZero() || window.isNegative()) {
            throw new IllegalStateException("rate-limit.login.window phải > 0");
        }
    }
}