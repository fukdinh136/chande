package com.chande.userservice.adapter.persistence;

import com.chande.userservice.adapter.security.BCryptPasswordHasher;
import com.chande.userservice.adapter.security.SecureRefreshTokenFactory;
import com.chande.userservice.adapter.security.UuidGenerator;
import com.chande.userservice.adapter.support.TestDatabase;
import com.chande.userservice.application.address.AddressCommand;
import com.chande.userservice.application.address.AddressService;
import com.chande.userservice.application.auth.AuthService;
import com.chande.userservice.application.auth.LoginCommand;
import com.chande.userservice.application.auth.RefreshCommand;
import com.chande.userservice.application.auth.RegisterCommand;
import com.chande.userservice.application.auth.TokenPair;
import com.chande.userservice.domain.address.Address;
import com.chande.userservice.domain.common.DomainException;
import com.chande.userservice.domain.common.ErrorCode;
import com.chande.userservice.domain.session.RefreshToken;
import com.chande.userservice.domain.user.PhoneNumber;
import com.chande.userservice.domain.user.User;
import com.chande.userservice.domain.user.UserStatus;
import com.chande.userservice.testing.FakeAccessTokenIssuer;
import com.chande.userservice.testing.MutableClock;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import javax.sql.DataSource;
import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Repository JDBC + transaction trên PostgreSQL thật, chạy migration V1+V2 của v1. */
class JdbcPersistenceTest {

    private static final Instant T0 = Instant.parse("2026-10-06T01:02:03.123456Z");

    private DataSource ds;
    private JdbcTransactionRunner tx;
    private JdbcUserRepository users;
    private JdbcRefreshTokenRepository tokens;
    private JdbcAddressRepository addresses;

    @BeforeEach
    void setUp() {
        ds = TestDatabase.get();
        TestDatabase.truncate(ds);
        tx = new JdbcTransactionRunner(ds);
        users = new JdbcUserRepository(tx);
        tokens = new JdbcRefreshTokenRepository(tx);
        addresses = new JdbcAddressRepository(tx);
    }

    private User newUser(String phone) {
        return User.register(UUID.randomUUID(), PhoneNumber.parse(phone), "$2a$10$hash", "Nguyễn Văn A", T0);
    }

    private User insertUser(String phone) {
        User user = newUser(phone);
        users.insert(user);
        return user;
    }

    private static void assertFails(ThrowingCallable call, ErrorCode code) {
        assertThatThrownBy(call).isInstanceOf(DomainException.class)
                .extracting(e -> ((DomainException) e).code()).isEqualTo(code);
    }

    private <T> T query(String sql, Class<T> type) {
        try (Connection c = ds.getConnection(); Statement s = c.createStatement(); ResultSet rs = s.executeQuery(sql)) {
            rs.next();
            return rs.getObject(1, type);
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    void migrationsProduceV2Schema() {
        assertThat(query("SELECT string_agg(version, ',' ORDER BY installed_rank) FROM flyway_schema_history "
                + "WHERE success", String.class)).isEqualTo("1,2");
        assertThat(query("SELECT character_maximum_length FROM information_schema.columns "
                + "WHERE table_name = 'user_addresses' AND column_name = 'address_text'", Integer.class)).isEqualTo(500);
        assertThat(query("SELECT is_nullable FROM information_schema.columns "
                + "WHERE table_name = 'user_addresses' AND column_name = 'lat'", String.class)).isEqualTo("NO");
    }

    @Nested
    class Users {

        @Test
        void roundTripKeepsMicroseconds() {
            User user = insertUser("0912345678");

            User loaded = users.findById(user.id()).orElseThrow();

            assertThat(loaded.phone().value()).isEqualTo("+84912345678");
            assertThat(loaded.passwordHash()).isEqualTo("$2a$10$hash");
            assertThat(loaded.fullName()).isEqualTo("Nguyễn Văn A");
            assertThat(loaded.avatarUrl()).isNull();
            assertThat(loaded.status()).isEqualTo(UserStatus.ACTIVE);
            assertThat(loaded.createdAt()).isEqualTo(T0);
            assertThat(loaded.updatedAt()).isEqualTo(T0);
            assertThat(users.existsByPhone(PhoneNumber.parse("0912345678"))).isTrue();
            assertThat(users.findByPhone(PhoneNumber.parse("+84912345678"))).isPresent();
            assertThat(users.findById(UUID.randomUUID())).isEmpty();
        }

        @Test
        void duplicatePhoneMapsToPhoneAlreadyExists() {
            insertUser("0912345678");
            assertFails(() -> users.insert(newUser("0912345678")), ErrorCode.PHONE_ALREADY_EXISTS);
        }

        @Test
        void updateProfileAndPasswordCompareAndSet() {
            User user = insertUser("0912345678");
            user.updateProfile("B", "https://cdn/a.png", T0.plusSeconds(1));
            users.updateProfile(user);
            User loaded = users.findById(user.id()).orElseThrow();
            assertThat(loaded.fullName()).isEqualTo("B");
            assertThat(loaded.avatarUrl()).isEqualTo("https://cdn/a.png");
            assertThat(loaded.updatedAt()).isEqualTo(T0.plusSeconds(1));

            assertThat(users.updatePasswordHash(user.id(), "wrong-old", "new", T0)).isFalse();
            assertThat(users.updatePasswordHash(user.id(), "$2a$10$hash", "new", T0.plusSeconds(2))).isTrue();
            assertThat(users.findById(user.id()).orElseThrow().passwordHash()).isEqualTo("new");
        }

        @Test
        void blockedStatusIsRead() {
            User user = insertUser("0912345678");
            TestDatabase.execute(ds, "UPDATE users SET status = 'BLOCKED' WHERE id = '" + user.id() + "'");
            assertThat(users.findById(user.id()).orElseThrow().isBlocked()).isTrue();
        }
    }

    @Nested
    class RefreshTokens {

        private User user;

        @BeforeEach
        void user() {
            user = insertUser("0912345678");
        }

        private RefreshToken insert(String hash, Instant expiresAt) {
            RefreshToken token = RefreshToken.issue(UUID.randomUUID(), user.id(), hash, expiresAt, T0);
            tokens.insert(token);
            return token;
        }

        @Test
        void insertFindRevokeDelete() {
            RefreshToken token = insert("a".repeat(64), T0.plus(Duration.ofDays(30)));

            RefreshToken loaded = tx.inTransaction(() -> tokens.findByHashForUpdate("a".repeat(64)).orElseThrow());
            assertThat(loaded.userId()).isEqualTo(user.id());
            assertThat(loaded.expiresAt()).isEqualTo(T0.plus(Duration.ofDays(30)));
            assertThat(loaded.isRevoked()).isFalse();

            tokens.markRevoked(token.id(), T0.plusSeconds(5));
            tokens.markRevoked(token.id(), T0.plusSeconds(9));
            assertThat(tx.inTransaction(() -> tokens.findByHashForUpdate("a".repeat(64)).orElseThrow()).revokedAt())
                    .isEqualTo(T0.plusSeconds(5));

            tokens.deleteByHash("a".repeat(64));
            assertThat(tx.inTransaction(() -> tokens.findByHashForUpdate("a".repeat(64)))).isEmpty();
        }

        @Test
        void deleteAllAndPurge() {
            insert("a".repeat(64), T0.minus(Duration.ofDays(2)));
            insert("b".repeat(64), T0.plus(Duration.ofDays(1)));
            insert("c".repeat(64), T0.plus(Duration.ofDays(2)));

            assertThat(tokens.deleteExpiredBefore(T0.minus(Duration.ofDays(1)))).isEqualTo(1);
            assertThat(tokens.deleteAllByUserId(user.id())).isEqualTo(2);
            assertThat(tokens.deleteAllByUserId(user.id())).isZero();
        }

        @Test
        void forUpdateMakesSecondTransactionWait() throws Exception {
            insert("a".repeat(64), T0.plus(Duration.ofDays(1)));
            CountDownLatch locked = new CountDownLatch(1);
            CountDownLatch release = new CountDownLatch(1);
            ExecutorService pool = Executors.newFixedThreadPool(2);
            try {
                Future<?> first = pool.submit(() -> tx.inTransaction(() -> {
                    tokens.findByHashForUpdate("a".repeat(64));
                    locked.countDown();
                    await(release);
                    return null;
                }));
                assertThat(locked.await(5, TimeUnit.SECONDS)).isTrue();
                Future<?> second = pool.submit(() -> tx.inTransaction(() -> tokens.findByHashForUpdate("a".repeat(64))));

                assertThatThrownBy(() -> second.get(300, TimeUnit.MILLISECONDS)).isInstanceOf(TimeoutException.class);
                release.countDown();
                first.get(5, TimeUnit.SECONDS);
                second.get(5, TimeUnit.SECONDS);
            } finally {
                release.countDown();
                pool.shutdownNow();
            }
        }
    }

    @Nested
    class Addresses {

        private User user;

        @BeforeEach
        void user() {
            user = insertUser("0912345678");
        }

        private Address address(String label, boolean isDefault, int secondsAfterT0) {
            return Address.create(UUID.randomUUID(), user.id(), label, label + " text", new BigDecimal("21.017"),
                    new BigDecimal("-105.7840000049"), isDefault, T0.plusSeconds(secondsAfterT0));
        }

        @Test
        void crudAndOrdering() {
            Address a = address("A", true, 0);
            Address b = address("B", false, 1);
            Address c = address("C", false, 2);
            addresses.insert(a);
            addresses.insert(b);
            addresses.insert(c);

            assertThat(addresses.listByUser(user.id())).extracting(Address::label).containsExactly("A", "C", "B");
            assertThat(addresses.countByUser(user.id())).isEqualTo(3);
            assertThat(addresses.findNewest(user.id()).orElseThrow().label()).isEqualTo("C");

            Address loaded = addresses.findOwned(user.id(), a.id()).orElseThrow();
            assertThat(loaded.lat()).isEqualByComparingTo("21.017").extracting(BigDecimal::scale).isEqualTo(8);
            assertThat(loaded.lng().toPlainString()).isEqualTo("-105.78400000");
            assertThat(loaded.createdAt()).isEqualTo(T0);
            assertThat(addresses.findOwned(UUID.randomUUID(), a.id())).isEmpty();

            assertThat(addresses.clearDefault(user.id())).isEqualTo(1);
            c.markDefault();
            c.replaceDetails(null, "C2", BigDecimal.ONE, BigDecimal.TEN);
            addresses.update(c);
            Address reloaded = addresses.findOwned(user.id(), c.id()).orElseThrow();
            assertThat(reloaded.label()).isNull();
            assertThat(reloaded.addressText()).isEqualTo("C2");
            assertThat(reloaded.isDefault()).isTrue();

            addresses.delete(c.id());
            assertThat(addresses.countByUser(user.id())).isEqualTo(2);
        }

        @Test
        void secondDefaultViolatesPartialUniqueIndex() {
            addresses.insert(address("A", true, 0));
            assertFails(() -> addresses.insert(address("B", true, 1)), ErrorCode.DATA_CONFLICT);
        }

        @Test
        void unknownUserViolatesForeignKey() {
            Address orphan = Address.create(UUID.randomUUID(), UUID.randomUUID(), null, "x", BigDecimal.ONE,
                    BigDecimal.ONE, true, T0);
            assertFails(() -> addresses.insert(orphan), ErrorCode.DATA_CONFLICT);
        }
    }

    @Nested
    class Transactions {

        @Test
        void exceptionRollsBackEverything() {
            assertThatThrownBy(() -> tx.inTransaction(() -> {
                users.insert(newUser("0912345678"));
                throw new IllegalStateException("boom");
            })).hasMessage("boom");
            assertThat(users.existsByPhone(PhoneNumber.parse("0912345678"))).isFalse();
        }

        @Test
        void nestedCallJoinsOuterTransaction() {
            assertThatThrownBy(() -> tx.inTransaction(() -> {
                tx.inTransaction(() -> {
                    users.insert(newUser("0912345678"));
                    return null;
                });
                throw new IllegalStateException("outer fails");
            })).hasMessage("outer fails");
            assertThat(users.existsByPhone(PhoneNumber.parse("0912345678"))).isFalse();
        }

        @Test
        void constraintViolationInsideTransactionRollsBackEarlierWrites() {
            insertUser("0912345678");
            assertFails(() -> tx.inTransaction(() -> {
                users.insert(newUser("0987654321"));
                users.insert(newUser("0912345678"));
                return null;
            }), ErrorCode.PHONE_ALREADY_EXISTS);
            assertThat(users.existsByPhone(PhoneNumber.parse("0987654321"))).isFalse();
        }
    }

    /** Use case thật trên JDBC thật: các đảm bảo chỉ kiểm được với DB thật (khoá dòng, commit khi trả lỗi). */
    @Nested
    class UseCasesOnPostgres {

        private final MutableClock clock = new MutableClock(T0);
        private AuthService auth;
        private AddressService address;

        @BeforeEach
        void services() {
            auth = new AuthService(users, tokens, new BCryptPasswordHasher(4, 8), new FakeAccessTokenIssuer(),
                    new SecureRefreshTokenFactory(), new UuidGenerator(), tx, clock, Duration.ofDays(30));
            address = new AddressService(addresses, users, new UuidGenerator(), tx, clock);
        }

        private int tokenCount() {
            return query("SELECT count(*)::int FROM user_refresh_tokens", Integer.class);
        }

        @Test
        void reuseDetectionCommitsDeletionAlthoughRequestFails() {
            auth.register(new RegisterCommand("0912345678", "matkhau123", "A"));
            TokenPair first = auth.login(new LoginCommand("0912345678", "matkhau123"));
            auth.login(new LoginCommand("0912345678", "matkhau123"));
            auth.refresh(new RefreshCommand(first.refreshToken()));
            assertThat(tokenCount()).isEqualTo(3);

            assertFails(() -> auth.refresh(new RefreshCommand(first.refreshToken())), ErrorCode.INVALID_REFRESH_TOKEN);

            assertThat(tokenCount()).isZero();
        }

        @Test
        void blockedUserRefreshCommitsDeletion() {
            auth.register(new RegisterCommand("0912345678", "matkhau123", "A"));
            TokenPair pair = auth.login(new LoginCommand("0912345678", "matkhau123"));
            TestDatabase.execute(ds, "UPDATE users SET status = 'BLOCKED'");

            assertFails(() -> auth.refresh(new RefreshCommand(pair.refreshToken())), ErrorCode.USER_BLOCKED);
            assertThat(tokenCount()).isZero();
        }

        @Test
        void concurrentRefreshWithSameTokenSucceedsOnlyOnce() throws Exception {
            auth.register(new RegisterCommand("0912345678", "matkhau123", "A"));
            TokenPair pair = auth.login(new LoginCommand("0912345678", "matkhau123"));

            List<Object> outcomes = runConcurrently(2, () -> auth.refresh(new RefreshCommand(pair.refreshToken())));

            assertThat(outcomes).filteredOn(TokenPair.class::isInstance).hasSize(1);
            assertThat(outcomes).filteredOn(o -> o == ErrorCode.INVALID_REFRESH_TOKEN).hasSize(1);
            // request sau bị coi là dùng lại token -> mọi phiên của user bị xoá
            assertThat(tokenCount()).isZero();
        }

        @Test
        void concurrentAddressCreationNeverExceedsLimit() throws Exception {
            UUID userId = auth.register(new RegisterCommand("0912345678", "matkhau123", "A")).id();

            List<Object> outcomes = runConcurrently(14, () -> address.create(userId,
                    new AddressCommand(null, "x", BigDecimal.ONE, BigDecimal.ONE, true)));

            assertThat(outcomes).filteredOn(o -> o == ErrorCode.ADDRESS_LIMIT_REACHED).hasSize(4);
            assertThat(addresses.countByUser(userId)).isEqualTo(10);
            assertThat(addresses.listByUser(userId)).filteredOn(Address::isDefault).hasSize(1);
        }

        @Test
        void concurrentRegistrationOfSamePhone() throws Exception {
            List<Object> outcomes = runConcurrently(4,
                    () -> auth.register(new RegisterCommand("0912345678", "matkhau123", "A")));

            assertThat(outcomes).filteredOn(o -> o == ErrorCode.PHONE_ALREADY_EXISTS).hasSize(3);
            assertThat(query("SELECT count(*)::int FROM users", Integer.class)).isEqualTo(1);
        }

        /** Chạy {@code n} lần đồng thời; kết quả là giá trị trả về hoặc ErrorCode của DomainException. */
        private List<Object> runConcurrently(int n, Callable<?> task) throws Exception {
            CountDownLatch start = new CountDownLatch(1);
            try (ExecutorService pool = Executors.newFixedThreadPool(n)) {
                List<Future<Object>> futures = new ArrayList<>();
                for (int i = 0; i < n; i++) {
                    futures.add(pool.submit(() -> {
                        start.await();
                        try {
                            return task.call();
                        } catch (DomainException e) {
                            return e.code();
                        }
                    }));
                }
                start.countDown();
                List<Object> results = new ArrayList<>();
                for (Future<Object> future : futures) {
                    results.add(future.get(30, TimeUnit.SECONDS));
                }
                return results;
            }
        }
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(10, TimeUnit.SECONDS)) {
                throw new IllegalStateException("timeout");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }
}
