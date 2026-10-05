package com.chande.userservice.testing;

import com.chande.userservice.application.address.AddressService;
import com.chande.userservice.application.auth.AuthService;
import com.chande.userservice.application.profile.ProfileService;
import com.chande.userservice.domain.user.PhoneNumber;
import com.chande.userservice.domain.user.User;
import com.chande.userservice.domain.user.UserStatus;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

/** Các use case thật nối với fake in-memory cho mọi port. */
public final class InMemoryWorld {

    public static final Duration REFRESH_TTL = Duration.ofDays(30);

    public final MutableClock clock = new MutableClock(Instant.parse("2026-10-06T01:02:03.123456789Z"));
    public final InMemoryUserRepository users = new InMemoryUserRepository();
    public final InMemoryRefreshTokenRepository refreshTokens = new InMemoryRefreshTokenRepository();
    public final InMemoryAddressRepository addresses = new InMemoryAddressRepository(users);
    public final FakePasswordHasher hasher = new FakePasswordHasher();
    public final FakeAccessTokenIssuer accessTokens = new FakeAccessTokenIssuer();
    public final FakeRefreshTokenFactory refreshTokenFactory = new FakeRefreshTokenFactory();
    public final SequentialIdGenerator ids = new SequentialIdGenerator();
    public final DirectTransactionRunner tx = new DirectTransactionRunner();

    public final AuthService auth = new AuthService(users, refreshTokens, hasher, accessTokens, refreshTokenFactory,
            ids, tx, clock, REFRESH_TTL);
    public final ProfileService profile = new ProfileService(users, tx, clock);
    public final AddressService address = new AddressService(addresses, users, ids, tx, clock);

    public InMemoryWorld() {
        hasher.reset(); // bỏ lời gọi băm hash giả trong constructor của AuthService
    }

    /** Thêm thẳng một user vào kho (không qua use case). */
    public User seedUser(String phone, String rawPassword, UserStatus status) {
        UUID id = ids.newId();
        User user = User.restore(id, PhoneNumber.parse(phone), FakePasswordHasher.hashOf(rawPassword), "Nguyễn Văn A",
                null, status, clock.instant(), clock.instant());
        users.insert(user);
        return user;
    }
}
