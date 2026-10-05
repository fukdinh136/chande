package com.chande.userservice.application.port;

import com.chande.userservice.domain.user.PhoneNumber;
import com.chande.userservice.domain.user.User;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

public interface UserRepository {

    boolean existsByPhone(PhoneNumber phone);

    Optional<User> findByPhone(PhoneNumber phone);

    Optional<User> findById(UUID id);

    /** Trùng SĐT (unique uk_users_phone_number) -> DomainException(PHONE_ALREADY_EXISTS). */
    void insert(User user);

    /** Ghi full_name, avatar_url, updated_at. */
    void updateProfile(User user);

    /**
     * So-sánh-rồi-ghi: chỉ cập nhật khi hash trong DB vẫn là {@code expectedOldHash}.
     *
     * @return false nếu có thao tác khác đã đổi mật khẩu trước (hoặc user không còn)
     */
    boolean updatePasswordHash(UUID id, String expectedOldHash, String newHash, Instant now);

    /** {@code SELECT ... FOR UPDATE} trên dòng user: tuần tự hoá thao tác địa chỉ của cùng user. Phải gọi trong transaction. */
    void lockForUpdate(UUID id);
}
