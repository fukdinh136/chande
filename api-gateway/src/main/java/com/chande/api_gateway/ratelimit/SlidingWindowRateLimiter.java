package com.chande.api_gateway.ratelimit;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class SlidingWindowRateLimiter {

    private static final int EVICT_THRESHOLD = 10_000;

    private final int maxRequests;
    private final Duration window;
    private final Clock clock;
    private final Map<String, Deque<Instant>> hits = new ConcurrentHashMap<>();

    public SlidingWindowRateLimiter(int maxRequests, Duration window, Clock clock) {
        this.maxRequests = maxRequests;
        this.window = window;
        this.clock = clock;
    }

    /**
     * @return 0 nếu được phép; ngược lại là số giây phải chờ (>= 1)
     */
    public long tryAcquire(String key) {
        Instant now = clock.instant();
        Instant windowStart = now.minus(window);
        long[] retryAfter = {0};

        hits.compute(key, (k, deque) -> {
            Deque<Instant> d = (deque == null) ? new ArrayDeque<>() : deque;
            while (!d.isEmpty() && !d.peekFirst().isAfter(windowStart)) {
                d.pollFirst();
            }
            if (d.size() < maxRequests) {
                d.addLast(now);
            } else {
                long waitMillis = Duration.between(now, d.peekFirst().plus(window)).toMillis();
                retryAfter[0] = Math.max(1, (waitMillis + 999) / 1000);
            }
            return d;
        });

        if (hits.size() > EVICT_THRESHOLD) {
            evictStale(windowStart);
        }
        return retryAfter[0];
    }

    private void evictStale(Instant windowStart) {
        for (String key : hits.keySet()) {
            hits.computeIfPresent(key, (k, d) -> {
                while (!d.isEmpty() && !d.peekFirst().isAfter(windowStart)) {
                    d.pollFirst();
                }
                return d.isEmpty() ? null : d;
            });
        }
    }
}