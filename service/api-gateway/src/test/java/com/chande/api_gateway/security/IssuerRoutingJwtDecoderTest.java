package com.chande.api_gateway.security;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.JWSSigner;
import com.nimbusds.jose.crypto.ECDSASigner;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.Curve;
import com.nimbusds.jose.jwk.ECKey;
import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.ECKeyGenerator;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.PlainJWT;
import com.nimbusds.jwt.SignedJWT;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;

import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class IssuerRoutingJwtDecoderTest {

    private static final String RIDER_ISS = "https://identity.example.invalid/rider";
    private static final String DRIVER_ISS = "https://identity.example.invalid/driver";

    private final RSAKey riderKey = new RSAKeyGenerator(2048).keyID("rider-1").generate();
    private final ECKey driverKey = new ECKeyGenerator(Curve.P_256).keyID("driver-1").generate();

    private final JwtProperties properties = new JwtProperties(Duration.ofSeconds(30), List.of(
            new JwtProperties.Issuer(RIDER_ISS, URI.create("http://user-service/.well-known/jwks.json"),
                    Set.of("RIDER"), Set.of()),
            new JwtProperties.Issuer(DRIVER_ISS, URI.create("http://driver-service/.well-known/jwks.json"),
                    Set.of("DRIVER"), Set.of("trip-service"))));

    private final Map<String, JWK> keysByIssuer = Map.of(RIDER_ISS, riderKey, DRIVER_ISS, driverKey);
    private final JwtDecoder decoder = IssuerRoutingJwtDecoder.create(properties,
            issuer -> new ImmutableJWKSet<>(new JWKSet(keysByIssuer.get(issuer.issuer()).toPublicJWK())));

    IssuerRoutingJwtDecoderTest() throws Exception {
    }

    private JWTClaimsSet.Builder claims(String issuer, String role) {
        Instant now = Instant.now();
        return new JWTClaimsSet.Builder()
                .issuer(issuer)
                .subject(UUID.randomUUID().toString())
                .audience(List.of("user-service", "trip-service"))
                .claim("role", role)
                .issueTime(Date.from(now))
                .expirationTime(Date.from(now.plusSeconds(300)));
    }

    private static String signRsa(RSAKey key, JWTClaimsSet claims) throws Exception {
        return sign(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(key.getKeyID())
                .type(new JOSEObjectType("at+jwt")).build(), new RSASSASigner(key), claims);
    }

    private static String signEc(ECKey key, JWTClaimsSet claims) throws Exception {
        return sign(new JWSHeader.Builder(JWSAlgorithm.ES256).keyID(key.getKeyID()).build(), new ECDSASigner(key), claims);
    }

    private static String sign(JWSHeader header, JWSSigner signer, JWTClaimsSet claims) throws Exception {
        SignedJWT jwt = new SignedJWT(header, claims);
        jwt.sign(signer);
        return jwt.serialize();
    }

    @Test
    void acceptsUserServiceTokenWithAtJwtType() throws Exception {
        Jwt jwt = decoder.decode(signRsa(riderKey, claims(RIDER_ISS, "RIDER").build()));
        assertThat(jwt.getClaimAsString("role")).isEqualTo("RIDER");
    }

    @Test
    void acceptsDriverTokenSignedWithEs256() throws Exception {
        Jwt jwt = decoder.decode(signEc(driverKey, claims(DRIVER_ISS, "DRIVER").build()));
        assertThat(jwt.getIssuer().toString()).isEqualTo(DRIVER_ISS);
    }

    @Test
    void issuerCannotGrantRolesItDoesNotOwn() throws Exception {
        String token = signEc(driverKey, claims(DRIVER_ISS, "RIDER").build());
        assertThatThrownBy(() -> decoder.decode(token)).isInstanceOf(JwtException.class);
    }

    @Test
    void rejectsUnknownIssuer() throws Exception {
        String token = signRsa(riderKey, claims("https://evil.example.invalid", "RIDER").build());
        assertThatThrownBy(() -> decoder.decode(token)).isInstanceOf(JwtException.class);
    }

    @Test
    void rejectsTokenSignedWithAnotherIssuersKey() throws Exception {
        String token = signEc(driverKey, claims(RIDER_ISS, "RIDER").build());
        assertThatThrownBy(() -> decoder.decode(token)).isInstanceOf(JwtException.class);
    }

    @Test
    void allowsThirtySecondsClockSkewOnly() throws Exception {
        Instant now = Instant.now();
        String slightlyExpired = signRsa(riderKey, claims(RIDER_ISS, "RIDER")
                .issueTime(Date.from(now.minusSeconds(310)))
                .expirationTime(Date.from(now.minusSeconds(10))).build());
        assertThat(decoder.decode(slightlyExpired)).isNotNull();

        String expired = signRsa(riderKey, claims(RIDER_ISS, "RIDER")
                .issueTime(Date.from(now.minusSeconds(360)))
                .expirationTime(Date.from(now.minusSeconds(60))).build());
        assertThatThrownBy(() -> decoder.decode(expired)).isInstanceOf(JwtException.class);
    }

    @Test
    void requiresExpAndUuidSubject() throws Exception {
        String noExp = signRsa(riderKey, claims(RIDER_ISS, "RIDER").expirationTime(null).build());
        assertThatThrownBy(() -> decoder.decode(noExp)).isInstanceOf(JwtException.class);

        String badSub = signRsa(riderKey, claims(RIDER_ISS, "RIDER").subject("not-a-uuid").build());
        assertThatThrownBy(() -> decoder.decode(badSub)).isInstanceOf(JwtException.class);
    }

    @Test
    void rejectsSymmetricAndUnsignedTokens() throws Exception {
        String hs256 = sign(new JWSHeader(JWSAlgorithm.HS256),
                new MACSigner("mot-secret-dai-hon-32-byte-de-ky-hs256!!"), claims(RIDER_ISS, "RIDER").build());
        assertThatThrownBy(() -> decoder.decode(hs256)).isInstanceOf(JwtException.class);

        String unsigned = new PlainJWT(claims(RIDER_ISS, "RIDER").build()).serialize();
        assertThatThrownBy(() -> decoder.decode(unsigned)).isInstanceOf(JwtException.class);

        assertThatThrownBy(() -> decoder.decode("khong-phai-jwt")).isInstanceOf(JwtException.class);
    }

    @Test
    void enforcesAudienceWhenConfigured() throws Exception {
        String wrongAudience = signEc(driverKey, claims(DRIVER_ISS, "DRIVER").audience("driver-service").build());
        assertThatThrownBy(() -> decoder.decode(wrongAudience)).isInstanceOf(JwtException.class);
    }

    @Test
    void mapsRoleClaimToRoleAuthority() throws Exception {
        Jwt jwt = decoder.decode(signEc(driverKey, claims(DRIVER_ISS, "DRIVER").build()));
        List<String> roles = new JwtConfig().jwtAuthenticationConverter().convert(jwt)
                .getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .filter(a -> a.startsWith("ROLE_"))
                .toList();
        assertThat(roles).containsExactly("ROLE_DRIVER");
    }
}
