package com.chande.userservice.domain.user;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/** Tài khoản khách đặt xe (role RIDER). */
public final class User {

    private final UUID id;
    private final PhoneNumber phone;
    private String passwordHash;
    private String fullName;
    private String avatarUrl;
    private final UserStatus status;
    private final Instant createdAt;
    private Instant updatedAt;

    private User(UUID id, PhoneNumber phone, String passwordHash, String fullName, String avatarUrl,
                 UserStatus status, Instant createdAt, Instant updatedAt) {
        this.id = Objects.requireNonNull(id, "id");
        this.phone = Objects.requireNonNull(phone, "phone");
        this.passwordHash = Objects.requireNonNull(passwordHash, "passwordHash");
        this.fullName = Objects.requireNonNull(fullName, "fullName");
        this.avatarUrl = avatarUrl;
        this.status = Objects.requireNonNull(status, "status");
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt");
        this.updatedAt = Objects.requireNonNull(updatedAt, "updatedAt");
    }

    /** Tài khoản mới: ACTIVE, chưa có avatar, họ tên đã trim. */
    public static User register(UUID id, PhoneNumber phone, String passwordHash, String fullName, Instant now) {
        return new User(id, phone, passwordHash, fullName.trim(), null, UserStatus.ACTIVE, now, now);
    }

    /** Dựng lại từ dữ liệu đã lưu (adapter lưu trữ dùng). */
    public static User restore(UUID id, PhoneNumber phone, String passwordHash, String fullName, String avatarUrl,
                               UserStatus status, Instant createdAt, Instant updatedAt) {
        return new User(id, phone, passwordHash, fullName, avatarUrl, status, createdAt, updatedAt);
    }

    public boolean isBlocked() {
        return status == UserStatus.BLOCKED;
    }

    /**
     * BR-20: chỉ sửa họ tên và avatar. {@code null} nghĩa là giữ nguyên; giá trị khác null được trim.
     *
     * @return true nếu có trường thực sự đổi giá trị (khi đó {@code updatedAt} = now)
     */
    public boolean updateProfile(String newFullName, String newAvatarUrl, Instant now) {
        boolean changed = false;
        if (newFullName != null && !newFullName.trim().equals(fullName)) {
            fullName = newFullName.trim();
            changed = true;
        }
        if (newAvatarUrl != null && !newAvatarUrl.trim().equals(avatarUrl)) {
            avatarUrl = newAvatarUrl.trim();
            changed = true;
        }
        if (changed) {
            updatedAt = now;
        }
        return changed;
    }

    public void changePasswordHash(String newHash, Instant now) {
        passwordHash = Objects.requireNonNull(newHash, "newHash");
        updatedAt = now;
    }

    public UUID id() {
        return id;
    }

    public PhoneNumber phone() {
        return phone;
    }

    public String passwordHash() {
        return passwordHash;
    }

    public String fullName() {
        return fullName;
    }

    public String avatarUrl() {
        return avatarUrl;
    }

    public UserStatus status() {
        return status;
    }

    public Instant createdAt() {
        return createdAt;
    }

    public Instant updatedAt() {
        return updatedAt;
    }
}
