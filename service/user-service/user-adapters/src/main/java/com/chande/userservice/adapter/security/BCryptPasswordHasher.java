package com.chande.userservice.adapter.security;

import com.chande.userservice.application.port.PasswordHasher;
import com.chande.userservice.application.port.PasswordHasher.BusyException;
import org.springframework.security.crypto.bcrypt.BCrypt;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

/**
 * BCrypt {@code $2a$} như {@code BCryptPasswordEncoder} mặc định của v1, nên verify được hash {@code $2a$10$} cũ.
 * Dùng thẳng lớp {@link BCrypt} (không kéo theo commons-logging như BCryptPasswordEncoder).
 * <p>
 * Phép băm chạy trên {@code maxConcurrent} platform thread riêng, không chạy trên virtual thread của request:
 * virtual thread chỉ có số carrier bằng số CPU, nên vài phép băm (khoảng 60 ms CPU mỗi lần ở cost 10) chiếm hết
 * carrier và request mới không chạy được tới chỗ xếp hàng. Khi đó hàng đợi thật nằm trong scheduler, không đo
 * được thời gian chờ, và p95 đăng nhập lên vài giây khi quá tải (đo 2026-11-23).
 * <p>
 * Request chờ chỗ băm quá {@code maxWait} thì bị từ chối bằng {@link BusyException} (load shedding) thay vì xếp
 * hàng vô hạn. Semaphore có số chỗ bằng số thread, nên hàng đợi của executor không bao giờ dài ra.
 */
public final class BCryptPasswordHasher implements PasswordHasher {

    /** BCrypt chỉ nhận tối đa 72 byte; quá thì thư viện ném IllegalArgumentException. */
    private static final int MAX_PASSWORD_BYTES = 72;

    private final int cost;
    private final SecureRandom random = new SecureRandom();
    private final Semaphore permits;
    private final long maxWaitNanos;
    private final ExecutorService workers;

    public BCryptPasswordHasher(int cost, int maxConcurrent, Duration maxWait) {
        if (cost < 4 || cost > 31) {
            throw new IllegalArgumentException("BCrypt cost must be between 4 and 31");
        }
        if (maxConcurrent < 1) {
            throw new IllegalArgumentException("maxConcurrent must be at least 1");
        }
        if (maxWait.isNegative()) {
            throw new IllegalArgumentException("maxWait must not be negative");
        }
        this.cost = cost;
        this.permits = new Semaphore(maxConcurrent, true);
        this.maxWaitNanos = maxWait.toNanos();
        this.workers = Executors.newFixedThreadPool(maxConcurrent,
                Thread.ofPlatform().daemon().name("bcrypt-", 1).factory());
    }

    @Override
    public String hash(String raw) {
        return run(() -> BCrypt.hashpw(raw, BCrypt.gensalt("$2a", cost, random)));
    }

    /** Mật khẩu quá 72 byte không thể khớp hash nào (không băm được), nên trả false thay vì để thư viện ném lỗi. */
    @Override
    public boolean matches(String raw, String hash) {
        if (raw.getBytes(StandardCharsets.UTF_8).length > MAX_PASSWORD_BYTES) {
            return false;
        }
        return run(() -> {
            try {
                return BCrypt.checkpw(raw, hash);
            } catch (IllegalArgumentException malformedHash) {
                return false;
            }
        });
    }

    /** Chờ chỗ tối đa {@code maxWait}, rồi chạy phép băm trên thread riêng; thread gọi (virtual) chỉ đứng chờ. */
    private <T> T run(Callable<T> work) {
        try {
            if (!permits.tryAcquire(maxWaitNanos, TimeUnit.NANOSECONDS)) {
                throw new BusyException();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new BusyException();
        }
        try {
            return workers.submit(work).get();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while hashing", e);
        } catch (ExecutionException e) {
            if (e.getCause() instanceof RuntimeException runtime) {
                throw runtime;
            }
            throw new IllegalStateException(e.getCause());
        } finally {
            permits.release();
        }
    }
}
