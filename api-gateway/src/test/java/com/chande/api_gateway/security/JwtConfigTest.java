package com.chande.api_gateway.security;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.*;

import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;

class JwtConfigTest {

    private static final String SECRET = "k69i-ride-hailing-dev-secret-key-2026-change-me";

    private final JwtConfig config =
            new JwtConfig(new JwtProperties(SECRET, List.of("user-service", "driver-service")));
    private final JwtDecoder decoder = config.jwtDecoder();

    private String sign(String secret, String issuer, String role, Instant expiresAt) {
        JwtEncoder encoder = new NimbusJwtEncoder(new ImmutableSecret<>(
                new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256")));
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(issuer)
                .subject(UUID.randomUUID().toString())
                .claim("role", role)
                .issuedAt(expiresAt.minusSeconds(900))
                .expiresAt(expiresAt)
                .build();
        JwsHeader header = JwsHeader.with(MacAlgorithm.HS256).build();
        return encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
    }

    private String validToken(String issuer, String role) {
        return sign(SECRET, issuer, role, Instant.now().plusSeconds(600));
    }

    @Test
    void acceptsTokenFromUserService() {
        Jwt jwt = decoder.decode(validToken("user-service", "CUSTOMER"));
        assertThat(jwt.getClaimAsString("iss")).isEqualTo("user-service");
    }

    @Test
    void acceptsTokenFromDriverService() {
        Jwt jwt = decoder.decode(validToken("driver-service", "DRIVER"));
        assertThat(jwt.getClaimAsString("iss")).isEqualTo("driver-service");
    }

    @Test
    void rejectsUnknownIssuer() {
        String token = validToken("hacker-service", "CUSTOMER");
        assertThrows(JwtValidationException.class, () -> decoder.decode(token));
    }

    @Test
    void rejectsTokenSignedWithAnotherSecret() {
        String token = sign("mot-secret-khac-hoan-toan-dai-hon-32-byte!!", "user-service", "CUSTOMER",
                Instant.now().plusSeconds(600));
        assertThrows(BadJwtException.class, () -> decoder.decode(token));
    }

    @Test
    void rejectsExpiredToken() {
        String token = sign(SECRET, "user-service", "CUSTOMER", Instant.now().minusSeconds(3600));
        assertThrows(JwtValidationException.class, () -> decoder.decode(token));
    }

    @Test
    void mapsRoleClaimToRoleAuthority() {
        Jwt jwt = decoder.decode(validToken("driver-service", "DRIVER"));
        List<String> roles = config.jwtAuthenticationConverter().convert(jwt)
                .getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .filter(a -> a.startsWith("ROLE_"))
                .toList();
        assertThat(roles).containsExactly("ROLE_DRIVER");
    }
}