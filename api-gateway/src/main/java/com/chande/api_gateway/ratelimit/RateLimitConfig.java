package com.chande.api_gateway.ratelimit;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;

@Configuration
public class RateLimitConfig {

    @Bean
    public SlidingWindowRateLimiter loginRateLimiter(LoginRateLimitProperties properties) {
        return new SlidingWindowRateLimiter(properties.maxAttempts(), properties.window(), Clock.systemUTC());
    }
}