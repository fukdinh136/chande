package com.chande.userservice.testing;

import com.chande.userservice.application.port.RefreshTokenRepository;
import com.chande.userservice.domain.session.RefreshToken;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

public final class InMemoryRefreshTokenRepository implements RefreshTokenRepository {

    private final Map<UUID, RefreshToken> rows = new LinkedHashMap<>();

    @Override
    public synchronized void insert(RefreshToken token) {
        if (findByHash(token.tokenHash()).isPresent()) {
            throw new IllegalStateException("duplicate token_hash");
        }
        rows.put(token.id(), copy(token));
    }

    @Override
    public synchronized Optional<RefreshToken> findByHashForUpdate(String tokenHash) {
        return findByHash(tokenHash);
    }

    @Override
    public synchronized void markRevoked(UUID id, Instant revokedAt) {
        RefreshToken row = rows.get(id);
        if (row != null && !row.isRevoked()) {
            rows.put(id, RefreshToken.restore(row.id(), row.userId(), row.tokenHash(), row.expiresAt(), revokedAt,
                    row.createdAt()));
        }
    }

    @Override
    public synchronized void deleteByHash(String tokenHash) {
        rows.values().removeIf(t -> t.tokenHash().equals(tokenHash));
    }

    @Override
    public synchronized int deleteAllByUserId(UUID userId) {
        int before = rows.size();
        rows.values().removeIf(t -> t.userId().equals(userId));
        return before - rows.size();
    }

    @Override
    public synchronized int deleteExpiredBefore(Instant cutoff) {
        int before = rows.size();
        rows.values().removeIf(t -> t.expiresAt().isBefore(cutoff));
        return before - rows.size();
    }

    // --- tiện ích cho test ---

    public synchronized Optional<RefreshToken> findByHash(String tokenHash) {
        return rows.values().stream().filter(t -> t.tokenHash().equals(tokenHash)).findFirst()
                .map(InMemoryRefreshTokenRepository::copy);
    }

    public synchronized List<RefreshToken> forUser(UUID userId) {
        return rows.values().stream().filter(t -> t.userId().equals(userId))
                .map(InMemoryRefreshTokenRepository::copy).toList();
    }

    public synchronized int count() {
        return rows.size();
    }

    private static RefreshToken copy(RefreshToken t) {
        return RefreshToken.restore(t.id(), t.userId(), t.tokenHash(), t.expiresAt(), t.revokedAt(), t.createdAt());
    }
}
