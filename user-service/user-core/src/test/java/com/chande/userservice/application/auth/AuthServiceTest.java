package com.chande.userservice.application.auth;

import com.chande.userservice.domain.common.DomainException;
import com.chande.userservice.domain.common.ErrorCode;
import com.chande.userservice.domain.session.RefreshToken;
import com.chande.userservice.domain.user.PhoneNumber;
import com.chande.userservice.domain.user.User;
import com.chande.userservice.domain.user.UserStatus;
import com.chande.userservice.testing.FakePasswordHasher;
import com.chande.userservice.testing.InMemoryWorld;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AuthServiceTest {

    private final InMemoryWorld w = new InMemoryWorld();

    private static void assertFails(ThrowingCallable call, ErrorCode code) {
        assertThatThrownBy(call).isInstanceOf(DomainException.class)
                .extracting(e -> ((DomainException) e).code()).isEqualTo(code);
    }

    @Nested
    class Register {

        @Test
        void normalizesPhoneHashesPasswordAndTrimsName() {
            RegisteredUser result = w.auth.register(new RegisterCommand("091 234 5678", "matkhau123", "  Nguyễn Văn A  "));

            assertThat(result.phoneNumber()).isEqualTo("+84912345678");
            assertThat(result.fullName()).isEqualTo("Nguyễn Văn A");
            assertThat(result.createdAt()).isEqualTo(w.clock.instant().truncatedTo(ChronoUnit.MICROS));
            User saved = w.users.findById(result.id()).orElseThrow();
            assertThat(saved.passwordHash()).isEqualTo(FakePasswordHasher.hashOf("matkhau123"));
            assertThat(saved.status()).isEqualTo(UserStatus.ACTIVE);
            assertThat(saved.avatarUrl()).isNull();
            assertThat(saved.updatedAt()).isEqualTo(saved.createdAt());
        }

        @Test
        void doesNotLogIn() {
            w.auth.register(new RegisterCommand("0912345678", "matkhau123", "A"));
            assertThat(w.refreshTokens.count()).isZero();
        }

        @Test
        void duplicatePhoneIsRejectedWithoutHashing() {
            w.seedUser("+84912345678", "x", UserStatus.ACTIVE);

            assertFails(() -> w.auth.register(new RegisterCommand("0912345678", "matkhau123", "A")),
                    ErrorCode.PHONE_ALREADY_EXISTS);
            assertThat(w.hasher.hashedPasswords()).isEmpty();
        }

        @Test
        void invalidPhoneIsRejectedBeforeTouchingStorage() {
            assertFails(() -> w.auth.register(new RegisterCommand("0123456789", "matkhau123", "A")),
                    ErrorCode.INVALID_PHONE_NUMBER);
            assertThat(w.hasher.hashedPasswords()).isEmpty();
            assertThat(w.users.count()).isZero();
            assertThat(w.tx.transactions()).isZero();
        }

        @Test
        void insertOnlyInsideTransaction() {
            w.auth.register(new RegisterCommand("0912345678", "matkhau123", "A"));
            assertThat(w.tx.transactions()).isEqualTo(1);
        }
    }

    @Nested
    class Login {

        @Test
        void issuesTokensAndStoresOnlyRefreshHash() {
            User user = w.seedUser("+84912345678", "matkhau123", UserStatus.ACTIVE);

            TokenPair pair = w.auth.login(new LoginCommand("0912 345 678", "matkhau123"));

            assertThat(pair.accessToken()).startsWith("access:" + user.id());
            assertThat(pair.expiresInSeconds()).isEqualTo(900);
            RefreshToken stored = w.refreshTokens.forUser(user.id()).getFirst();
            assertThat(stored.tokenHash()).isEqualTo(w.refreshTokenFactory.hash(pair.refreshToken()))
                    .isNotEqualTo(pair.refreshToken());
            assertThat(stored.expiresAt()).isEqualTo(stored.createdAt().plus(Duration.ofDays(30)));
            assertThat(stored.isRevoked()).isFalse();
        }

        @Test
        void eachLoginCreatesNewSession() {
            w.seedUser("+84912345678", "matkhau123", UserStatus.ACTIVE);
            w.auth.login(new LoginCommand("0912345678", "matkhau123"));
            w.auth.login(new LoginCommand("0912345678", "matkhau123"));
            assertThat(w.refreshTokens.count()).isEqualTo(2);
        }

        @Test
        void unknownPhoneStillRunsBcryptAgainstDummyHash() {
            assertFails(() -> w.auth.login(new LoginCommand("0912345678", "matkhau123")),
                    ErrorCode.INVALID_CREDENTIALS);
            assertThat(w.hasher.matchedHashes()).hasSize(1);
            assertThat(w.hasher.matchedHashes().getFirst()).startsWith("hashed:"); // hash giả tạo lúc khởi động
        }

        @Test
        void wrongPassword() {
            w.seedUser("+84912345678", "matkhau123", UserStatus.ACTIVE);
            assertFails(() -> w.auth.login(new LoginCommand("0912345678", "sai12345")), ErrorCode.INVALID_CREDENTIALS);
            assertThat(w.refreshTokens.count()).isZero();
        }

        @Test
        void blockedUserWithCorrectPasswordGets403() {
            w.seedUser("+84912345678", "matkhau123", UserStatus.BLOCKED);
            assertFails(() -> w.auth.login(new LoginCommand("0912345678", "matkhau123")), ErrorCode.USER_BLOCKED);
        }

        @Test
        void blockedUserWithWrongPasswordGets401() {
            w.seedUser("+84912345678", "matkhau123", UserStatus.BLOCKED);
            assertFails(() -> w.auth.login(new LoginCommand("0912345678", "sai12345")), ErrorCode.INVALID_CREDENTIALS);
        }

        @Test
        void invalidPhone() {
            assertFails(() -> w.auth.login(new LoginCommand("12345", "x")), ErrorCode.INVALID_PHONE_NUMBER);
        }
    }

    @Nested
    class Refresh {

        private User user;
        private TokenPair first;

        private void login() {
            user = w.seedUser("+84912345678", "matkhau123", UserStatus.ACTIVE);
            first = w.auth.login(new LoginCommand("0912345678", "matkhau123"));
        }

        @Test
        void rotatesToken() {
            login();
            w.clock.advance(Duration.ofDays(10));

            TokenPair second = w.auth.refresh(new RefreshCommand(first.refreshToken()));

            assertThat(second.refreshToken()).isNotEqualTo(first.refreshToken());
            RefreshToken old = w.refreshTokens.findByHash(w.refreshTokenFactory.hash(first.refreshToken())).orElseThrow();
            assertThat(old.revokedAt()).isEqualTo(w.clock.instant().truncatedTo(ChronoUnit.MICROS));
            RefreshToken fresh = w.refreshTokens.findByHash(w.refreshTokenFactory.hash(second.refreshToken())).orElseThrow();
            assertThat(fresh.isRevoked()).isFalse();
            // BR-12: hạn mới tính từ lúc refresh (trượt 30 ngày)
            assertThat(fresh.expiresAt()).isEqualTo(old.revokedAt().plus(Duration.ofDays(30)));
        }

        @Test
        void reuseOfRotatedTokenDeletesAllSessions() {
            login();
            w.auth.login(new LoginCommand("0912345678", "matkhau123")); // phiên ở thiết bị khác
            TokenPair second = w.auth.refresh(new RefreshCommand(first.refreshToken()));

            assertFails(() -> w.auth.refresh(new RefreshCommand(first.refreshToken())), ErrorCode.INVALID_REFRESH_TOKEN);

            assertThat(w.refreshTokens.forUser(user.id())).isEmpty();
            assertFails(() -> w.auth.refresh(new RefreshCommand(second.refreshToken())), ErrorCode.INVALID_REFRESH_TOKEN);
        }

        @Test
        void reuseOfRotatedAndExpiredTokenStillDeletesAll() {
            login();
            w.auth.refresh(new RefreshCommand(first.refreshToken()));
            w.clock.advance(Duration.ofDays(31));

            assertFails(() -> w.auth.refresh(new RefreshCommand(first.refreshToken())), ErrorCode.INVALID_REFRESH_TOKEN);
            assertThat(w.refreshTokens.forUser(user.id())).isEmpty();
        }

        @Test
        void expiredTokenIsRejectedWithoutDeletingOthers() {
            login();
            w.clock.advance(Duration.ofDays(30).plusNanos(1000));

            assertFails(() -> w.auth.refresh(new RefreshCommand(first.refreshToken())), ErrorCode.INVALID_REFRESH_TOKEN);
            assertThat(w.refreshTokens.forUser(user.id())).hasSize(1);
        }

        @Test
        void tokenExactlyAtExpiryIsStillValid() {
            login();
            w.clock.advance(Duration.ofDays(30));
            assertThat(w.auth.refresh(new RefreshCommand(first.refreshToken()))).isNotNull();
        }

        @Test
        void unknownToken() {
            assertFails(() -> w.auth.refresh(new RefreshCommand("khong-ton-tai")), ErrorCode.INVALID_REFRESH_TOKEN);
        }

        @Test
        void blockedUserLosesAllSessions() {
            login();
            w.auth.login(new LoginCommand("0912345678", "matkhau123"));
            w.users.setStatus(user.id(), UserStatus.BLOCKED);

            assertFails(() -> w.auth.refresh(new RefreshCommand(first.refreshToken())), ErrorCode.USER_BLOCKED);
            assertThat(w.refreshTokens.forUser(user.id())).isEmpty();
        }
    }

    @Nested
    class Logout {

        @Test
        void deletesOnlyThatToken() {
            User user = w.seedUser("+84912345678", "matkhau123", UserStatus.ACTIVE);
            TokenPair a = w.auth.login(new LoginCommand("0912345678", "matkhau123"));
            w.auth.login(new LoginCommand("0912345678", "matkhau123"));

            w.auth.logout(new RefreshCommand(a.refreshToken()));

            assertThat(w.refreshTokens.forUser(user.id())).hasSize(1);
            assertFails(() -> w.auth.refresh(new RefreshCommand(a.refreshToken())), ErrorCode.INVALID_REFRESH_TOKEN);
        }

        @Test
        void unknownTokenIsNotAnError() {
            w.auth.logout(new RefreshCommand("khong-ton-tai"));
        }

        @Test
        void logoutAllDeletesEverySession() {
            User user = w.seedUser("+84912345678", "matkhau123", UserStatus.ACTIVE);
            User other = w.seedUser("+84987654321", "matkhau123", UserStatus.ACTIVE);
            w.auth.login(new LoginCommand("0912345678", "matkhau123"));
            w.auth.login(new LoginCommand("0912345678", "matkhau123"));
            w.auth.login(new LoginCommand("0987654321", "matkhau123"));

            w.auth.logoutAll(user.id());

            assertThat(w.refreshTokens.forUser(user.id())).isEmpty();
            assertThat(w.refreshTokens.forUser(other.id())).hasSize(1);
        }

        @Test
        void logoutAllForUnknownUserIsNotAnError() {
            w.auth.logoutAll(UUID.randomUUID());
        }
    }

    @Nested
    class ChangePassword {

        @Test
        void changesHashAndDeletesAllSessions() {
            User user = w.seedUser("+84912345678", "matkhau123", UserStatus.ACTIVE);
            w.auth.login(new LoginCommand("0912345678", "matkhau123"));
            w.auth.login(new LoginCommand("0912345678", "matkhau123"));
            w.clock.advance(Duration.ofMinutes(5));

            w.auth.changePassword(user.id(), new ChangePasswordCommand("matkhau123", "matkhaumoi456"));

            User saved = w.users.findById(user.id()).orElseThrow();
            assertThat(saved.passwordHash()).isEqualTo(FakePasswordHasher.hashOf("matkhaumoi456"));
            assertThat(saved.updatedAt()).isEqualTo(w.clock.instant().truncatedTo(ChronoUnit.MICROS));
            assertThat(w.refreshTokens.forUser(user.id())).isEmpty(); // Q4: không cấp token mới
        }

        @Test
        void wrongOldPasswordChangesNothing() {
            User user = w.seedUser("+84912345678", "matkhau123", UserStatus.ACTIVE);
            w.auth.login(new LoginCommand("0912345678", "matkhau123"));

            assertFails(() -> w.auth.changePassword(user.id(), new ChangePasswordCommand("sai12345", "matkhaumoi456")),
                    ErrorCode.WRONG_OLD_PASSWORD);
            assertThat(w.users.findById(user.id()).orElseThrow().passwordHash())
                    .isEqualTo(FakePasswordHasher.hashOf("matkhau123"));
            assertThat(w.refreshTokens.forUser(user.id())).hasSize(1);
        }

        @Test
        void wrongOldPasswordIsCheckedBeforeSameAsOld() {
            User user = w.seedUser("+84912345678", "matkhau123", UserStatus.ACTIVE);
            assertFails(() -> w.auth.changePassword(user.id(), new ChangePasswordCommand("sai12345a", "sai12345a")),
                    ErrorCode.WRONG_OLD_PASSWORD);
        }

        @Test
        void newPasswordSameAsOld() {
            User user = w.seedUser("+84912345678", "matkhau123", UserStatus.ACTIVE);
            assertFails(() -> w.auth.changePassword(user.id(), new ChangePasswordCommand("matkhau123", "matkhau123")),
                    ErrorCode.NEW_PASSWORD_SAME_AS_OLD);
        }

        @Test
        void unknownUser() {
            assertFails(() -> w.auth.changePassword(UUID.randomUUID(), new ChangePasswordCommand("matkhau123", "moi12345")),
                    ErrorCode.USER_NOT_FOUND);
        }

        @Test
        void concurrentChangeIsDetected() {
            User user = w.seedUser("+84912345678", "matkhau123", UserStatus.ACTIVE);
            w.auth.login(new LoginCommand("0912345678", "matkhau123"));
            // Hasher chạy ngoài transaction: giả lập request khác đổi mật khẩu đúng lúc đó
            var racingHasher = new com.chande.userservice.application.port.PasswordHasher() {
                @Override
                public String hash(String raw) {
                    if (raw.equals("matkhaumoi456")) {
                        w.users.overwritePasswordHash(user.id(), "hashed:by-someone-else");
                    }
                    return w.hasher.hash(raw);
                }

                @Override
                public boolean matches(String raw, String hash) {
                    return w.hasher.matches(raw, hash);
                }
            };
            AuthService auth = new AuthService(w.users, w.refreshTokens, racingHasher, w.accessTokens,
                    w.refreshTokenFactory, w.ids, w.tx, w.clock, InMemoryWorld.REFRESH_TTL);

            assertFails(() -> auth.changePassword(user.id(), new ChangePasswordCommand("matkhau123", "matkhaumoi456")),
                    ErrorCode.DATA_CONFLICT);
            assertThat(w.users.findById(user.id()).orElseThrow().passwordHash()).isEqualTo("hashed:by-someone-else");
        }
    }

    @Test
    void purgeDeletesOnlyTokensExpiredBeforeRetention() {
        w.seedUser("+84912345678", "matkhau123", UserStatus.ACTIVE);
        w.auth.login(new LoginCommand("0912345678", "matkhau123"));
        w.clock.advance(Duration.ofDays(30).plusHours(12));
        w.auth.login(new LoginCommand("0912345678", "matkhau123"));

        assertThat(w.auth.purgeExpiredRefreshTokens(Duration.ofDays(1))).isZero();
        w.clock.advance(Duration.ofHours(13));
        assertThat(w.auth.purgeExpiredRefreshTokens(Duration.ofDays(1))).isEqualTo(1);
        assertThat(w.refreshTokens.count()).isEqualTo(1);
    }

    @Test
    void registeredUserCanLogIn() {
        w.auth.register(new RegisterCommand("0912345678", "matkhau123", "A"));
        assertThat(w.auth.login(new LoginCommand("+84912345678", "matkhau123"))).isNotNull();
        assertThat(w.users.findByPhone(PhoneNumber.parse("0912345678"))).isPresent();
    }
}
