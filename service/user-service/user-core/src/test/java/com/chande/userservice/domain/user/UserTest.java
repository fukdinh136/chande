package com.chande.userservice.domain.user;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class UserTest {

    private static final Instant T0 = Instant.parse("2026-10-06T00:00:00Z");
    private static final Instant T1 = T0.plusSeconds(60);

    private User newUser() {
        return User.register(UUID.randomUUID(), PhoneNumber.parse("0912345678"), "h", "  Nguyễn Văn A  ", T0);
    }

    @Test
    void registerTrimsNameAndStartsActive() {
        User u = newUser();
        assertThat(u.fullName()).isEqualTo("Nguyễn Văn A");
        assertThat(u.status()).isEqualTo(UserStatus.ACTIVE);
        assertThat(u.avatarUrl()).isNull();
        assertThat(u.createdAt()).isEqualTo(T0);
        assertThat(u.updatedAt()).isEqualTo(T0);
    }

    @Test
    void updateProfileNullKeepsValue() {
        User u = newUser();
        assertThat(u.updateProfile(" Nguyễn Văn B ", null, T1)).isTrue();
        assertThat(u.fullName()).isEqualTo("Nguyễn Văn B");
        assertThat(u.avatarUrl()).isNull();
        assertThat(u.updatedAt()).isEqualTo(T1);
    }

    @Test
    void updateProfileWithSameValuesChangesNothing() {
        User u = newUser();
        assertThat(u.updateProfile("Nguyễn Văn A ", null, T1)).isFalse();
        assertThat(u.updateProfile(null, null, T1)).isFalse();
        assertThat(u.updatedAt()).isEqualTo(T0);
    }
}
