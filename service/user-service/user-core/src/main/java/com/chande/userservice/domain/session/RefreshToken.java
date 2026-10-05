package com.chande.userservice.domain.session;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * Một phiên đăng nhập. DB chỉ lưu SHA-256 của token gốc.
 * {@code revokedAt} khác null nghĩa là token <b>đã xoay vòng</b> (BR-12): dòng được giữ lại để phát hiện dùng lại.
 */
public final class RefreshToken {

    private final UUID id;
    private final UUID userId;
    private final String tokenHash;
    private final Instant expiresAt;
    private Instant revokedAt;
    private final Instant createdAt;

    private RefreshToken(UUID id, UUID userId, String tokenHash, Instant expiresAt, Instant revokedAt, Instant createdAt) {
        this.id = Objects.requireNonNull(id, "id");
        this.userId = Objects.requireNonNull(userId, "userId");
        this.tokenHash = Objects.requireNonNull(tokenHash, "tokenHash");
        this.expiresAt = Objects.requireNonNull(expiresAt, "expiresAt");
        this.revokedAt = revokedAt;
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt");
    }

    public static RefreshToken issue(UUID id, UUID userId, String tokenHash, Instant expiresAt, Instant now) {
        return new RefreshToken(id, userId, tokenHash, expiresAt, null, now);
    }

    public static RefreshToken restore(UUID id, UUID userId, String tokenHash, Instant expiresAt,
                                       Instant revokedAt, Instant createdAt) {
        return new RefreshToken(id, userId, tokenHash, expiresAt, revokedAt, createdAt);
    }

    public boolean isRevoked() {
        return revokedAt != null;
    }

    /** BR-15: hết hạn khi {@code expiresAt < now} (so sánh chặt). */
    public boolean isExpired(Instant now) {
        return expiresAt.isBefore(now);
    }

    /** Đánh dấu đã xoay vòng; gọi lại lần nữa không đổi thời điểm cũ. */
    public void revoke(Instant now) {
        if (revokedAt == null) {
            revokedAt = now;
        }
    }

    public UUID id() {
        return id;
    }

    public UUID userId() {
        return userId;
    }

    public String tokenHash() {
        return tokenHash;
    }

    public Instant expiresAt() {
        return expiresAt;
    }

    public Instant revokedAt() {
        return revokedAt;
    }

    public Instant createdAt() {
        return createdAt;
    }
}
