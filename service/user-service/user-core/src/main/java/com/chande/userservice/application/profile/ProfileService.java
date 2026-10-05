package com.chande.userservice.application.profile;

import com.chande.userservice.application.port.TransactionRunner;
import com.chande.userservice.application.port.UserRepository;
import com.chande.userservice.domain.common.DomainException;
import com.chande.userservice.domain.common.ErrorCode;
import com.chande.userservice.domain.user.User;

import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.Objects;
import java.util.UUID;

/** Hồ sơ (P1, P2) và tra cứu nội bộ (I1). Không kiểm status: user bị khoá vẫn xem/sửa được tới khi token hết hạn. */
public final class ProfileService {

    private final UserRepository users;
    private final TransactionRunner tx;
    private final Clock clock;

    public ProfileService(UserRepository users, TransactionRunner tx, Clock clock) {
        this.users = Objects.requireNonNull(users);
        this.tx = Objects.requireNonNull(tx);
        this.clock = Objects.requireNonNull(clock);
    }

    /** P1. */
    public UserView getProfile(UUID userId) {
        return UserView.from(findUser(userId));
    }

    /** P2. Last-write-wins, không có version. Không có trường nào đổi giá trị thì không ghi DB. */
    public UserView updateProfile(UUID userId, UpdateProfileCommand cmd) {
        return tx.inTransaction(() -> {
            User user = findUser(userId);
            if (user.updateProfile(cmd.fullName(), cmd.avatarUrl(), clock.instant().truncatedTo(ChronoUnit.MICROS))) {
                users.updateProfile(user);
            }
            return UserView.from(user);
        });
    }

    /** I1. */
    public InternalUserView getInternalUser(UUID userId) {
        return InternalUserView.from(findUser(userId));
    }

    private User findUser(UUID userId) {
        return users.findById(userId).orElseThrow(() -> new DomainException(ErrorCode.USER_NOT_FOUND));
    }
}
