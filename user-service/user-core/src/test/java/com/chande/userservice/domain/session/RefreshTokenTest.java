package com.chande.userservice.domain.session;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class RefreshTokenTest {

    private static final Instant NOW = Instant.parse("2026-10-06T00:00:00Z");

    @Test
    void expiryIsStrict() {
        RefreshToken token = RefreshToken.issue(UUID.randomUUID(), UUID.randomUUID(), "h", NOW, NOW.minusSeconds(10));

        assertThat(token.isExpired(NOW)).isFalse();
        assertThat(token.isExpired(NOW.plusNanos(1000))).isTrue();
    }

    @Test
    void revokeKeepsFirstTimestamp() {
        RefreshToken token = RefreshToken.issue(UUID.randomUUID(), UUID.randomUUID(), "h", NOW.plusSeconds(60), NOW);
        assertThat(token.isRevoked()).isFalse();

        token.revoke(NOW);
        token.revoke(NOW.plusSeconds(5));

        assertThat(token.isRevoked()).isTrue();
        assertThat(token.revokedAt()).isEqualTo(NOW);
    }
}
