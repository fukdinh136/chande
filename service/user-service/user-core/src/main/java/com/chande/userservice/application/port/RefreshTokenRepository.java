package com.chande.userservice.application.port;

import com.chande.userservice.domain.session.RefreshToken;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

public interface RefreshTokenRepository {

    void insert(RefreshToken token);

    /** Khoá dòng token ({@code FOR UPDATE}). Phải gọi trong transaction. */
    Optional<RefreshToken> findByHashForUpdate(String tokenHash);

    void markRevoked(UUID id, Instant revokedAt);

    void deleteByHash(String tokenHash);

    /** @return số token đã xoá */
    int deleteAllByUserId(UUID userId);

    /** Dọn token có {@code expires_at < cutoff}. @return số token đã xoá */
    int deleteExpiredBefore(Instant cutoff);
}
