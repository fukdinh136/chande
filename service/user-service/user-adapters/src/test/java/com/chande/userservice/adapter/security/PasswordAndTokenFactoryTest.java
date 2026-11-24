package com.chande.userservice.adapter.security;

import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PasswordAndTokenFactoryTest {

    private final BCryptPasswordHasher hasher = new BCryptPasswordHasher(10, 2, java.time.Duration.ofSeconds(5));

    @Test
    void hashesWith2aCost10LikeV1() {
        String hash = hasher.hash("matkhau123");
        assertThat(hash).startsWith("$2a$10$").hasSize(60);
        assertThat(hasher.matches("matkhau123", hash)).isTrue();
        assertThat(hasher.matches("matkhau124", hash)).isFalse();
    }

    @Test
    void verifiesExistingV1Hash() {
        // Hash $2a$10$ sinh bởi BCryptPasswordEncoder mặc định (v1) cho "password"
        String v1Hash = "$2a$10$dXJ3SW6G7P50lGmMkkmwe.20cQQubK3.HZWzG3YB1tlRy.fqvM/BG";
        assertThat(hasher.matches("password", v1Hash)).isTrue();
        assertThat(hasher.matches("Password", v1Hash)).isFalse();
    }

    @Test
    void passwordOver72BytesNeverMatchesInsteadOfThrowing() {
        String hash = hasher.hash("a".repeat(72));
        assertThat(hasher.matches("ệ".repeat(25), hash)).isFalse();
    }

    @Test
    void rejectsInsteadOfQueueingWhenEveryPermitIsBusyPastMaxWait() throws Exception {
        // Một chỗ băm, chờ tối đa 20 ms; cost 14 giữ chỗ khoảng 1 giây.
        var saturated = new BCryptPasswordHasher(14, 1, java.time.Duration.ofMillis(20));
        var holder = Thread.ofPlatform().start(() -> saturated.hash("dang-giu-cho"));
        try {
            Thread.sleep(100);
            long started = System.nanoTime();
            assertThatThrownBy(() -> saturated.matches("matkhau123", "$2a$04$abcdefghijklmnopqrstuu"))
                    .isInstanceOf(com.chande.userservice.application.port.PasswordHasher.BusyException.class);
            assertThat(java.time.Duration.ofNanos(System.nanoTime() - started)).isLessThan(java.time.Duration.ofMillis(500));
        } finally {
            holder.join();
        }
        // Hết bận thì băm lại bình thường.
        assertThat(saturated.matches("x", saturated.hash("x"))).isTrue();
    }

    @Test
    void manyVirtualThreadCallersAreShedNotQueued() throws Exception {
        // Request chạy trên virtual thread như HttpServer; một chỗ băm, chờ tối đa 50 ms, mỗi phép băm khoảng 60 ms.
        var hasher1 = new BCryptPasswordHasher(10, 1, java.time.Duration.ofMillis(50));
        String stored = hasher1.hash("matkhau123");
        var ok = new java.util.concurrent.atomic.AtomicInteger();
        var busy = new java.util.concurrent.atomic.AtomicInteger();
        try (var callers = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            for (int i = 0; i < 20; i++) {
                callers.submit(() -> {
                    try {
                        if (hasher1.matches("matkhau123", stored)) ok.incrementAndGet();
                    } catch (com.chande.userservice.application.port.PasswordHasher.BusyException e) {
                        busy.incrementAndGet();
                    }
                });
            }
        }
        assertThat(ok.get() + busy.get()).isEqualTo(20);
        assertThat(ok.get()).isPositive();
        assertThat(busy.get()).as("callers past the 50 ms wait are rejected").isGreaterThan(10);
    }

    @Test
    void malformedHashDoesNotThrow() {
        assertThat(hasher.matches("x", "not-a-bcrypt-hash")).isFalse();
    }

    @Test
    void refreshTokenIs43CharBase64UrlAndHashIsSha256Hex() {
        SecureRefreshTokenFactory factory = new SecureRefreshTokenFactory();
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < 100; i++) {
            var token = factory.generate();
            assertThat(token.raw()).hasSize(43).matches("[A-Za-z0-9_-]+");
            assertThat(token.hash()).hasSize(64).matches("[0-9a-f]+").isEqualTo(factory.hash(token.raw()));
            assertThat(seen.add(token.raw())).isTrue();
        }
        // SHA-256 của chuỗi "abc"
        assertThat(factory.hash("abc")).isEqualTo("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }
}
