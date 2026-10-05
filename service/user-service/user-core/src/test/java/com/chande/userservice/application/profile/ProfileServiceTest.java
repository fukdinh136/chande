package com.chande.userservice.application.profile;

import com.chande.userservice.domain.common.DomainException;
import com.chande.userservice.domain.common.ErrorCode;
import com.chande.userservice.domain.user.User;
import com.chande.userservice.domain.user.UserStatus;
import com.chande.userservice.testing.InMemoryWorld;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ProfileServiceTest {

    private final InMemoryWorld w = new InMemoryWorld();

    @Test
    void getProfile() {
        User user = w.seedUser("+84912345678", "matkhau123", UserStatus.ACTIVE);

        UserView view = w.profile.getProfile(user.id());

        assertThat(view).isEqualTo(new UserView(user.id(), "+84912345678", "Nguyễn Văn A", null, user.createdAt()));
    }

    @Test
    void blockedUserCanStillReadProfile() {
        User user = w.seedUser("+84912345678", "matkhau123", UserStatus.BLOCKED);
        assertThat(w.profile.getProfile(user.id()).id()).isEqualTo(user.id());
    }

    @Test
    void unknownUser() {
        assertThatThrownBy(() -> w.profile.getProfile(UUID.randomUUID()))
                .isInstanceOf(DomainException.class)
                .extracting(e -> ((DomainException) e).code()).isEqualTo(ErrorCode.USER_NOT_FOUND);
        assertThatThrownBy(() -> w.profile.updateProfile(UUID.randomUUID(), new UpdateProfileCommand("B", null)))
                .extracting(e -> ((DomainException) e).code()).isEqualTo(ErrorCode.USER_NOT_FOUND);
    }

    @Test
    void updatingOnlyNameKeepsAvatar() {
        User user = w.seedUser("+84912345678", "matkhau123", UserStatus.ACTIVE);
        w.profile.updateProfile(user.id(), new UpdateProfileCommand(null, "https://cdn.example.com/a.png"));
        w.clock.advance(Duration.ofMinutes(1));

        UserView view = w.profile.updateProfile(user.id(), new UpdateProfileCommand("  Nguyễn Văn B ", null));

        assertThat(view.fullName()).isEqualTo("Nguyễn Văn B");
        assertThat(view.avatarUrl()).isEqualTo("https://cdn.example.com/a.png");
        User saved = w.users.findById(user.id()).orElseThrow();
        assertThat(saved.fullName()).isEqualTo("Nguyễn Văn B");
        assertThat(saved.updatedAt()).isAfter(user.updatedAt());
    }

    @Test
    void emptyBodyChangesNothing() {
        User user = w.seedUser("+84912345678", "matkhau123", UserStatus.ACTIVE);
        w.clock.advance(Duration.ofMinutes(1));

        UserView view = w.profile.updateProfile(user.id(), new UpdateProfileCommand(null, null));

        assertThat(view.fullName()).isEqualTo("Nguyễn Văn A");
        assertThat(w.users.findById(user.id()).orElseThrow().updatedAt()).isEqualTo(user.updatedAt());
    }

    @Test
    void internalUserIncludesPhoneAndStatus() {
        User user = w.seedUser("+84912345678", "matkhau123", UserStatus.BLOCKED);

        assertThat(w.profile.getInternalUser(user.id()))
                .isEqualTo(new InternalUserView(user.id(), "Nguyễn Văn A", "+84912345678", UserStatus.BLOCKED));
    }
}
