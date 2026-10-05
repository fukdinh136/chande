package com.chande.userservice.adapter.security;

import com.chande.userservice.adapter.support.TestJwts;
import com.chande.userservice.adapter.support.TestKeys;
import com.chande.userservice.application.port.AccessTokenIssuer.AccessToken;
import com.chande.userservice.testing.MutableClock;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class JwtTest {

    private static final String ISSUER = "https://identity.example.invalid/rider";
    private static final Instant NOW = Instant.parse("2026-10-06T00:00:00Z");
    private static final UUID USER = UUID.fromString("30000000-0000-4000-8000-000000000001");

    private final RsaKeys keys = RsaKeys.of("user-2026-10", TestKeys.privateKey(TestKeys.CURRENT),
            Map.of("user-2026-09", TestKeys.publicKey(TestKeys.PREVIOUS)));
    private final Rs256AccessTokenIssuer issuer =
            new Rs256AccessTokenIssuer(keys.current(), ISSUER, List.of(), Duration.ofMinutes(15));
    private final MutableClock clock = new MutableClock(NOW);
    private final Rs256JwtVerifier verifier = new Rs256JwtVerifier(keys.all(), ISSUER, Duration.ofSeconds(60), clock);

    private Map<String, Object> header(String alg, String kid) {
        Map<String, Object> h = new LinkedHashMap<>();
        h.put("alg", alg);
        h.put("typ", "JWT");
        h.put("kid", kid);
        return h;
    }

    private Map<String, Object> claims() {
        Map<String, Object> c = new LinkedHashMap<>();
        c.put("iss", ISSUER);
        c.put("sub", USER.toString());
        c.put("role", "RIDER");
        c.put("iat", NOW.getEpochSecond());
        c.put("exp", NOW.getEpochSecond() + 900);
        return c;
    }

    private String signed(Map<String, Object> claims) {
        return TestJwts.rs256(TestKeys.CURRENT.getPrivate(), header("RS256", "user-2026-10"), claims);
    }

    private void assertRejected(String token) {
        assertThatThrownBy(() -> verifier.verify(token)).isInstanceOf(Rs256JwtVerifier.InvalidTokenException.class);
    }

    @Test
    void issuedTokenHasExpectedHeaderAndClaims() {
        AccessToken token = issuer.issue(USER, NOW.plusNanos(123_456_789));

        assertThat(token.expiresInSeconds()).isEqualTo(900);
        assertThat(TestJwts.decodePart(token.value(), 0))
                .containsExactly(Map.entry("alg", "RS256"), Map.entry("typ", "at+jwt"), Map.entry("kid", "user-2026-10"));
        Map<String, Object> claims = TestJwts.decodePart(token.value(), 1);
        assertThat(claims).containsEntry("iss", ISSUER).containsEntry("sub", USER.toString())
                .containsEntry("role", "RIDER").doesNotContainKey("aud");
        long iat = ((Number) claims.get("iat")).longValue();
        assertThat(iat).isEqualTo(NOW.getEpochSecond());
        assertThat(((Number) claims.get("exp")).longValue()).isEqualTo(iat + 900);
        assertThat(UUID.fromString((String) claims.get("jti"))).isNotNull();
    }

    @Test
    void roundTrip() {
        Rs256JwtVerifier.VerifiedToken verified = verifier.verify(issuer.issue(USER, NOW).value());
        assertThat(verified).isEqualTo(new Rs256JwtVerifier.VerifiedToken(USER, "RIDER"));
    }

    @Test
    void audienceIsWrittenWhenConfigured() {
        var withAud = new Rs256AccessTokenIssuer(keys.current(), ISSUER, List.of("trip-service"), Duration.ofMinutes(15));
        assertThat(TestJwts.decodePart(withAud.issue(USER, NOW).value(), 1)).containsEntry("aud", List.of("trip-service"));
    }

    @Test
    void tokenSignedWithPreviousKeyStillVerifiesDuringRotation() {
        String token = TestJwts.rs256(TestKeys.PREVIOUS.getPrivate(), header("RS256", "user-2026-09"), claims());
        assertThat(verifier.verify(token).subject()).isEqualTo(USER);
    }

    @Test
    void expiryAllowsClockSkew() {
        String token = issuer.issue(USER, NOW).value();
        clock.set(NOW.plusSeconds(900 + 60));
        assertThat(verifier.verify(token).subject()).isEqualTo(USER);
        clock.set(NOW.plusSeconds(900 + 61));
        assertRejected(token);
    }

    @Test
    void rejectsAlgNone() {
        assertRejected(TestJwts.unsigned(header("none", "user-2026-10"), claims()));
    }

    @Test
    void rejectsHs256SignedWithPublicKeyBytes() {
        byte[] publicKeyBytes = TestKeys.CURRENT.getPublic().getEncoded();
        assertRejected(TestJwts.hs256(publicKeyBytes, header("HS256", "user-2026-10"), claims()));
    }

    @Test
    void rejectsUnknownOrMissingKid() {
        assertRejected(TestJwts.rs256(TestKeys.CURRENT.getPrivate(), header("RS256", "other"), claims()));
        Map<String, Object> noKid = header("RS256", "x");
        noKid.remove("kid");
        assertRejected(TestJwts.rs256(TestKeys.CURRENT.getPrivate(), noKid, claims()));
    }

    @Test
    void rejectsBadSignature() {
        String token = issuer.issue(USER, NOW).value();
        String tampered = token.substring(0, token.lastIndexOf('.') + 1) + "AAAA" + token.substring(token.lastIndexOf('.') + 5);
        assertRejected(tampered);
        // payload bị sửa (đổi sub) nhưng giữ chữ ký cũ
        String[] parts = token.split("\\.");
        String otherPayload = signed(Map.of("iss", ISSUER, "sub", UUID.randomUUID().toString(), "role", "RIDER",
                "exp", NOW.getEpochSecond() + 900)).split("\\.")[1];
        assertRejected(parts[0] + "." + otherPayload + "." + parts[2]);
        // ký bằng khoá khác nhưng mạo danh kid hiện hành
        assertRejected(TestJwts.rs256(TestKeys.generate(2048).getPrivate(), header("RS256", "user-2026-10"), claims()));
    }

    @Test
    void rejectsWrongIssuerMissingExpAndNonUuidSubject() {
        Map<String, Object> wrongIss = claims();
        wrongIss.put("iss", ISSUER + "/");
        assertRejected(signed(wrongIss));

        Map<String, Object> noExp = claims();
        noExp.remove("exp");
        assertRejected(signed(noExp));

        Map<String, Object> stringExp = claims();
        stringExp.put("exp", String.valueOf(NOW.getEpochSecond() + 900));
        assertRejected(signed(stringExp));

        Map<String, Object> badSub = claims();
        badSub.put("sub", "1-1-1-1-1");
        assertRejected(signed(badSub));
    }

    @Test
    void rejectsFutureNbf() {
        Map<String, Object> c = claims();
        c.put("nbf", NOW.getEpochSecond() + 120);
        assertRejected(signed(c));
    }

    @Test
    void rejectsMalformedTokens() {
        assertRejected("");
        assertRejected("abc");
        assertRejected("a.b.c.d");
        String token = issuer.issue(USER, NOW).value();
        assertRejected(token + "=");
        assertRejected("x" + token);
    }

    @Test
    void roleIsReturnedForCallerToCheck() {
        Map<String, Object> c = claims();
        c.put("role", "DRIVER");
        assertThat(verifier.verify(signed(c)).role()).isEqualTo("DRIVER");
        c.remove("role");
        assertThat(verifier.verify(signed(c)).role()).isNull();
    }
}
