package com.chande.userservice.adapter.security;

import com.chande.userservice.application.port.PasswordHasher;
import org.springframework.security.crypto.bcrypt.BCrypt;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.concurrent.Semaphore;

/**
 * BCrypt {@code $2a$} như {@code BCryptPasswordEncoder} mặc định của v1, nên verify được hash {@code $2a$10$} cũ.
 * Dùng thẳng lớp {@link BCrypt} (không kéo theo commons-logging như BCryptPasswordEncoder).
 * <p>
 * BCrypt tốn CPU mà virtual thread thì không giới hạn: một {@link Semaphore} chặn số phép băm chạy đồng thời.
 */
public final class BCryptPasswordHasher implements PasswordHasher {

    /** BCrypt chỉ nhận tối đa 72 byte; quá thì thư viện ném IllegalArgumentException. */
    private static final int MAX_PASSWORD_BYTES = 72;

    private final int cost;
    private final SecureRandom random = new SecureRandom();
    private final Semaphore permits;

    public BCryptPasswordHasher(int cost, int maxConcurrent) {
        if (cost < 4 || cost > 31) {
            throw new IllegalArgumentException("BCrypt cost must be between 4 and 31");
        }
        this.cost = cost;
        this.permits = new Semaphore(maxConcurrent, true);
    }

    @Override
    public String hash(String raw) {
        permits.acquireUninterruptibly();
        try {
            return BCrypt.hashpw(raw, BCrypt.gensalt("$2a", cost, random));
        } finally {
            permits.release();
        }
    }

    /** Mật khẩu quá 72 byte không thể khớp hash nào (không băm được), nên trả false thay vì để thư viện ném lỗi. */
    @Override
    public boolean matches(String raw, String hash) {
        if (raw.getBytes(StandardCharsets.UTF_8).length > MAX_PASSWORD_BYTES) {
            return false;
        }
        permits.acquireUninterruptibly();
        try {
            return BCrypt.checkpw(raw, hash);
        } catch (IllegalArgumentException malformedHash) {
            return false;
        } finally {
            permits.release();
        }
    }
}
