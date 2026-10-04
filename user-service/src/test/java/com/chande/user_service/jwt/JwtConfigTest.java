package com.chande.user_service.jwt;

import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.*;

import java.time.Duration;
import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class JwtConfigTest {

    private static final String SECRET = "k69i-ride-hailing-dev-secret-key-2026-change-me";

    private final JwtConfig config = new JwtConfig(
            new JwtProperties(SECRET, "user-service", Duration.ofMinutes(15), Duration.ofDays(30)));
    private final JwtDecoder decoder = config.jwtDecoder();

    // Ký một token bằng encoder của config truyền vào
    private String sign(JwtConfig signer, String issuer, Instant issuedAt, Instant expiresAt) {
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(issuer)
                .subject("user-123")
                .issuedAt(issuedAt)
                .expiresAt(expiresAt)
                .build();
        JwsHeader header = JwsHeader.with(MacAlgorithm.HS256).build();
        return signer.jwtEncoder().encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
    }

    @Test
    void validToken_isAccepted() {
        String token = sign(config, "user-service", Instant.now(), Instant.now().plusSeconds(900));
        assertEquals("user-123", decoder.decode(token).getSubject());
    }

    @Test
    void tokenSignedWithOtherSecret_isRejected() {
        JwtConfig attacker = new JwtConfig(new JwtProperties(
                "a-completely-different-secret-key-2026-xyz", "user-service",
                Duration.ofMinutes(15), Duration.ofDays(30)));
        String fake = sign(attacker, "user-service", Instant.now(), Instant.now().plusSeconds(900));
        assertThrows(JwtException.class, () -> decoder.decode(fake));
    }

    @Test
    void expiredToken_isRejected() {
        Instant twoHoursAgo = Instant.now().minusSeconds(7200);
        String old = sign(config, "user-service", twoHoursAgo, twoHoursAgo.plusSeconds(900));
        assertThrows(JwtException.class, () -> decoder.decode(old));
    }

    @Test
    void wrongIssuer_isRejected() {
        String other = sign(config, "driver-service", Instant.now(), Instant.now().plusSeconds(900));
        assertThrows(JwtException.class, () -> decoder.decode(other));
    }
}