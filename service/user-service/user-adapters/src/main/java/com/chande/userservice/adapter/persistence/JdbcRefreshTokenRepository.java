package com.chande.userservice.adapter.persistence;

import com.chande.userservice.application.port.RefreshTokenRepository;
import com.chande.userservice.domain.session.RefreshToken;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static com.chande.userservice.adapter.persistence.JdbcSupport.getInstant;
import static com.chande.userservice.adapter.persistence.JdbcSupport.getUuid;
import static com.chande.userservice.adapter.persistence.JdbcSupport.setInstant;

public final class JdbcRefreshTokenRepository implements RefreshTokenRepository {

    private final ConnectionProvider db;

    public JdbcRefreshTokenRepository(ConnectionProvider db) {
        this.db = db;
    }

    @Override
    public void insert(RefreshToken token) {
        db.withConnection(c -> {
            try (PreparedStatement ps = c.prepareStatement("INSERT INTO user_refresh_tokens "
                    + "(id, user_id, token_hash, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)")) {
                ps.setObject(1, token.id());
                ps.setObject(2, token.userId());
                ps.setString(3, token.tokenHash());
                setInstant(ps, 4, token.expiresAt());
                setInstant(ps, 5, token.createdAt());
                return ps.executeUpdate();
            }
        });
    }

    @Override
    public Optional<RefreshToken> findByHashForUpdate(String tokenHash) {
        return db.withConnection(c -> {
            try (PreparedStatement ps = c.prepareStatement("SELECT id, user_id, token_hash, expires_at, revoked_at, "
                    + "created_at FROM user_refresh_tokens WHERE token_hash = ? FOR UPDATE")) {
                ps.setString(1, tokenHash);
                try (ResultSet rs = ps.executeQuery()) {
                    if (!rs.next()) {
                        return Optional.empty();
                    }
                    return Optional.of(RefreshToken.restore(
                            getUuid(rs, "id"),
                            getUuid(rs, "user_id"),
                            rs.getString("token_hash"),
                            getInstant(rs, "expires_at"),
                            getInstant(rs, "revoked_at"),
                            getInstant(rs, "created_at")));
                }
            }
        });
    }

    @Override
    public void markRevoked(UUID id, Instant revokedAt) {
        db.withConnection(c -> {
            try (PreparedStatement ps = c.prepareStatement(
                    "UPDATE user_refresh_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")) {
                setInstant(ps, 1, revokedAt);
                ps.setObject(2, id);
                return ps.executeUpdate();
            }
        });
    }

    @Override
    public void deleteByHash(String tokenHash) {
        db.withConnection(c -> {
            try (PreparedStatement ps = c.prepareStatement("DELETE FROM user_refresh_tokens WHERE token_hash = ?")) {
                ps.setString(1, tokenHash);
                return ps.executeUpdate();
            }
        });
    }

    @Override
    public int deleteAllByUserId(UUID userId) {
        return db.withConnection(c -> {
            try (PreparedStatement ps = c.prepareStatement("DELETE FROM user_refresh_tokens WHERE user_id = ?")) {
                ps.setObject(1, userId);
                return ps.executeUpdate();
            }
        });
    }

    @Override
    public int deleteExpiredBefore(Instant cutoff) {
        return db.withConnection(c -> {
            try (PreparedStatement ps = c.prepareStatement("DELETE FROM user_refresh_tokens WHERE expires_at < ?")) {
                setInstant(ps, 1, cutoff);
                return ps.executeUpdate();
            }
        });
    }
}
