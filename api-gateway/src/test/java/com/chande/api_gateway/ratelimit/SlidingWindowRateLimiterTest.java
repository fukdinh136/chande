package com.chande.api_gateway.ratelimit;

import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;

class SlidingWindowRateLimiterTest {

    static class MutableClock extends Clock {
        private Instant now = Instant.parse("2026-10-03T00:00:00Z");

        void advance(Duration d) { now = now.plus(d); }

        @Override public Instant instant() { return now; }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
    }

    private final MutableClock clock = new MutableClock();
    private final SlidingWindowRateLimiter limiter =
            new SlidingWindowRateLimiter(5, Duration.ofSeconds(60), clock);

    @Test
    void allowsUpToMaxAttempts() {
        for (int i = 0; i < 5; i++) {
            assertThat(limiter.tryAcquire("1.1.1.1")).isZero();
        }
    }

    @Test
    void blocksSixthAttemptWithRetryAfter() {
        for (int i = 0; i < 5; i++) limiter.tryAcquire("1.1.1.1");
        assertThat(limiter.tryAcquire("1.1.1.1")).isEqualTo(60);
    }

    @Test
    void differentIpsAreCountedSeparately() {
        for (int i = 0; i < 5; i++) limiter.tryAcquire("1.1.1.1");
        assertThat(limiter.tryAcquire("2.2.2.2")).isZero();
    }

    @Test
    void allowsAgainAfterWindowPasses() {
        for (int i = 0; i < 5; i++) limiter.tryAcquire("1.1.1.1");
        clock.advance(Duration.ofSeconds(61));
        assertThat(limiter.tryAcquire("1.1.1.1")).isZero();
    }

    @Test
    void windowSlidesInsteadOfResetting() {
        for (int i = 0; i < 5; i++) {
            limiter.tryAcquire("1.1.1.1");
            clock.advance(Duration.ofSeconds(10));
        }
        assertThat(limiter.tryAcquire("1.1.1.1")).isEqualTo(10);
        clock.advance(Duration.ofSeconds(11));
        assertThat(limiter.tryAcquire("1.1.1.1")).isZero();
    }
}