package com.chande.userservice.testing;

import com.chande.userservice.application.port.UserRepository;
import com.chande.userservice.domain.common.DomainException;
import com.chande.userservice.domain.common.ErrorCode;
import com.chande.userservice.domain.user.PhoneNumber;
import com.chande.userservice.domain.user.User;
import com.chande.userservice.domain.user.UserStatus;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** Lưu bản sao (giống DB): sửa object đã đọc ra không đổi dữ liệu đã lưu nếu chưa gọi update. */
public final class InMemoryUserRepository implements UserRepository {

    private final Map<UUID, User> rows = new LinkedHashMap<>();
    private int locks;

    @Override
    public synchronized boolean existsByPhone(PhoneNumber phone) {
        return rows.values().stream().anyMatch(u -> u.phone().equals(phone));
    }

    @Override
    public synchronized Optional<User> findByPhone(PhoneNumber phone) {
        return rows.values().stream().filter(u -> u.phone().equals(phone)).findFirst().map(InMemoryUserRepository::copy);
    }

    @Override
    public synchronized Optional<User> findById(UUID id) {
        return Optional.ofNullable(rows.get(id)).map(InMemoryUserRepository::copy);
    }

    @Override
    public synchronized void insert(User user) {
        if (existsByPhone(user.phone())) {
            throw new DomainException(ErrorCode.PHONE_ALREADY_EXISTS);
        }
        rows.put(user.id(), copy(user));
    }

    @Override
    public synchronized void updateProfile(User user) {
        User row = rows.get(user.id());
        if (row != null) {
            rows.put(user.id(), User.restore(row.id(), row.phone(), row.passwordHash(), user.fullName(),
                    user.avatarUrl(), row.status(), row.createdAt(), user.updatedAt()));
        }
    }

    @Override
    public synchronized boolean updatePasswordHash(UUID id, String expectedOldHash, String newHash, Instant now) {
        User row = rows.get(id);
        if (row == null || !row.passwordHash().equals(expectedOldHash)) {
            return false;
        }
        rows.put(id, User.restore(row.id(), row.phone(), newHash, row.fullName(), row.avatarUrl(), row.status(),
                row.createdAt(), now));
        return true;
    }

    @Override
    public synchronized void lockForUpdate(UUID id) {
        locks++;
    }

    // --- tiện ích cho test ---

    public synchronized void setStatus(UUID id, UserStatus status) {
        User row = rows.get(id);
        rows.put(id, User.restore(row.id(), row.phone(), row.passwordHash(), row.fullName(), row.avatarUrl(), status,
                row.createdAt(), row.updatedAt()));
    }

    /** Giả lập có người đổi mật khẩu ngay trước khi ta ghi. */
    public synchronized void overwritePasswordHash(UUID id, String hash) {
        User row = rows.get(id);
        rows.put(id, User.restore(row.id(), row.phone(), hash, row.fullName(), row.avatarUrl(), row.status(),
                row.createdAt(), row.updatedAt()));
    }

    public synchronized boolean exists(UUID id) {
        return rows.containsKey(id);
    }

    public synchronized int count() {
        return rows.size();
    }

    public synchronized int locks() {
        return locks;
    }

    private static User copy(User u) {
        return User.restore(u.id(), u.phone(), u.passwordHash(), u.fullName(), u.avatarUrl(), u.status(),
                u.createdAt(), u.updatedAt());
    }
}
