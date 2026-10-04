package com.chande.user_service.jwt;

import com.chande.user_service.user.User;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;

import java.time.Duration;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;

class JwtServiceTest {

    private static final JwtProperties PROPS = new JwtProperties(
            "k69i-ride-hailing-dev-secret-key-2026-change-me", "user-service",
            Duration.ofMinutes(15), Duration.ofDays(30));

    private final JwtConfig config = new JwtConfig(PROPS);
    private final JwtService jwtService = new JwtService(config.jwtEncoder(), PROPS);
    private final JwtDecoder decoder = config.jwtDecoder();

    @Test
    void accessToken_hasCorrectClaims() {
        User user = new User();
        UUID id = UUID.randomUUID();
        user.setId(id);
        user.setPhoneNumber("+84912345678");
        user.setFullName("Nguyễn Văn A");

        String token = jwtService.createAccessToken(user);
        System.out.println("ACCESS TOKEN: " + token);   // Để dán thử vào jwt.io

        Jwt jwt = decoder.decode(token);   // Decoder thật phải chấp nhận token

        assertEquals(id.toString(), jwt.getSubject());
        assertEquals("RIDER", jwt.getClaimAsString("role"));
        assertEquals("user-service", jwt.getClaimAsString("iss"));
        assertEquals(Duration.ofMinutes(15), Duration.between(jwt.getIssuedAt(), jwt.getExpiresAt()));

        // Token chỉ được có đúng 5 claim: không có SĐT, họ tên
        assertEquals(Set.of("iss", "sub", "iat", "exp", "role"), jwt.getClaims().keySet());
    }

    @Test
    void accessTokenTtlSeconds_matchesConfig() {
        assertEquals(900, jwtService.accessTokenTtlSeconds());
    }
}