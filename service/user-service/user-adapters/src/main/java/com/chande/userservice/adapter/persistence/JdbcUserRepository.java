package com.chande.userservice.adapter.persistence;

import com.chande.userservice.application.port.UserRepository;
import com.chande.userservice.domain.user.PhoneNumber;
import com.chande.userservice.domain.user.User;
import com.chande.userservice.domain.user.UserStatus;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static com.chande.userservice.adapter.persistence.JdbcSupport.getInstant;
import static com.chande.userservice.adapter.persistence.JdbcSupport.getUuid;
import static com.chande.userservice.adapter.persistence.JdbcSupport.setInstant;

public final class JdbcUserRepository implements UserRepository {

    private static final String COLUMNS =
            "id, phone_number, password_hash, full_name, avatar_url, status, created_at, updated_at";

    private final ConnectionProvider db;

    public JdbcUserRepository(ConnectionProvider db) {
        this.db = db;
    }

    @Override
    public boolean existsByPhone(PhoneNumber phone) {
        return db.withConnection(c -> {
            try (PreparedStatement ps = c.prepareStatement("SELECT EXISTS(SELECT 1 FROM users WHERE phone_number = ?)")) {
                ps.setString(1, phone.value());
                try (ResultSet rs = ps.executeQuery()) {
                    rs.next();
                    return rs.getBoolean(1);
                }
            }
        });
    }

    @Override
    public Optional<User> findByPhone(PhoneNumber phone) {
        return db.withConnection(c -> {
            try (PreparedStatement ps = c.prepareStatement("SELECT " + COLUMNS + " FROM users WHERE phone_number = ?")) {
                ps.setString(1, phone.value());
                return single(ps);
            }
        });
    }

    @Override
    public Optional<User> findById(UUID id) {
        return db.withConnection(c -> {
            try (PreparedStatement ps = c.prepareStatement("SELECT " + COLUMNS + " FROM users WHERE id = ?")) {
                ps.setObject(1, id);
                return single(ps);
            }
        });
    }

    @Override
    public void insert(User user) {
        db.withConnection(c -> {
            try (PreparedStatement ps = c.prepareStatement(
                    "INSERT INTO users (" + COLUMNS + ") VALUES (?, ?, ?, ?, ?, ?, ?, ?)")) {
                ps.setObject(1, user.id());
                ps.setString(2, user.phone().value());
                ps.setString(3, user.passwordHash());
                ps.setString(4, user.fullName());
                ps.setString(5, user.avatarUrl());
                ps.setString(6, user.status().name());
                setInstant(ps, 7, user.createdAt());
                setInstant(ps, 8, user.updatedAt());
                return ps.executeUpdate();
            }
        });
    }

    @Override
    public void updateProfile(User user) {
        db.withConnection(c -> {
            try (PreparedStatement ps = c.prepareStatement(
                    "UPDATE users SET full_name = ?, avatar_url = ?, updated_at = ? WHERE id = ?")) {
                ps.setString(1, user.fullName());
                ps.setString(2, user.avatarUrl());
                setInstant(ps, 3, user.updatedAt());
                ps.setObject(4, user.id());
                return ps.executeUpdate();
            }
        });
    }

    @Override
    public boolean updatePasswordHash(UUID id, String expectedOldHash, String newHash, Instant now) {
        return db.withConnection(c -> {
            try (PreparedStatement ps = c.prepareStatement(
                    "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ? AND password_hash = ?")) {
                ps.setString(1, newHash);
                setInstant(ps, 2, now);
                ps.setObject(3, id);
                ps.setString(4, expectedOldHash);
                return ps.executeUpdate() == 1;
            }
        });
    }

    @Override
    public void lockForUpdate(UUID id) {
        db.withConnection(c -> {
            try (PreparedStatement ps = c.prepareStatement("SELECT 1 FROM users WHERE id = ? FOR UPDATE")) {
                ps.setObject(1, id);
                try (ResultSet rs = ps.executeQuery()) {
                    return rs.next();
                }
            }
        });
    }

    private static Optional<User> single(PreparedStatement ps) throws SQLException {
        try (ResultSet rs = ps.executeQuery()) {
            if (!rs.next()) {
                return Optional.empty();
            }
            return Optional.of(User.restore(
                    getUuid(rs, "id"),
                    new PhoneNumber(rs.getString("phone_number")),
                    rs.getString("password_hash"),
                    rs.getString("full_name"),
                    rs.getString("avatar_url"),
                    UserStatus.valueOf(rs.getString("status")),
                    getInstant(rs, "created_at"),
                    getInstant(rs, "updated_at")));
        }
    }
}
