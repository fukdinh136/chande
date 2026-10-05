package com.chande.api_gateway.support;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpServer;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.UUID;

/**
 * Giả lập hai issuer như tài liệu: User Service (khách, RIDER) và Driver Service (tài xế, DRIVER),
 * mỗi bên một khoá RSA và một endpoint JWKS riêng.
 */
public final class TestTokens implements AutoCloseable {

    public static final String RIDER_ISSUER = "https://identity.example.invalid/rider";
    public static final String DRIVER_ISSUER = "https://identity.example.invalid/driver";

    private final RSAKey riderKey;
    private final RSAKey driverKey;
    private final HttpServer jwksServer;

    public TestTokens() {
        try {
            riderKey = new RSAKeyGenerator(2048).keyID("rider-key-1").generate();
            driverKey = new RSAKeyGenerator(2048).keyID("driver-key-1").generate();
            jwksServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            serveJwks("/rider/jwks.json", riderKey);
            serveJwks("/driver/jwks.json", driverKey);
            jwksServer.start();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    public String riderJwksUri() {
        return "http://127.0.0.1:" + jwksServer.getAddress().getPort() + "/rider/jwks.json";
    }

    public String driverJwksUri() {
        return "http://127.0.0.1:" + jwksServer.getAddress().getPort() + "/driver/jwks.json";
    }

    public String rider(UUID userId) {
        return sign(riderKey, RIDER_ISSUER, "RIDER", userId, Instant.now().plusSeconds(300));
    }

    public String driver(UUID userId) {
        return sign(driverKey, DRIVER_ISSUER, "DRIVER", userId, Instant.now().plusSeconds(300));
    }

    public String expiredRider(UUID userId) {
        return sign(riderKey, RIDER_ISSUER, "RIDER", userId, Instant.now().minusSeconds(3600));
    }

    /** Token ký bằng khoá của Driver Service nhưng tự nhận role RIDER. */
    public String driverIssuerClaimingRider(UUID userId) {
        return sign(driverKey, DRIVER_ISSUER, "RIDER", userId, Instant.now().plusSeconds(300));
    }

    public String unknownIssuer(UUID userId) {
        return sign(riderKey, "https://evil.example.invalid", "RIDER", userId, Instant.now().plusSeconds(300));
    }

    public String riderExpiringAt(UUID userId, Instant expiresAt) {
        return sign(riderKey, RIDER_ISSUER, "RIDER", userId, expiresAt);
    }

    private static String sign(RSAKey key, String issuer, String role, UUID subject, Instant expiresAt) {
        try {
            JWTClaimsSet claims = new JWTClaimsSet.Builder()
                    .issuer(issuer)
                    .subject(subject.toString())
                    .audience(List.of("user-service", "trip-service"))
                    .claim("role", role)
                    .jwtID(UUID.randomUUID().toString())
                    .issueTime(Date.from(expiresAt.minusSeconds(300)))
                    .expirationTime(Date.from(expiresAt))
                    .build();
            JWSHeader header = new JWSHeader.Builder(JWSAlgorithm.RS256)
                    .keyID(key.getKeyID())
                    .type(new JOSEObjectType("at+jwt"))
                    .build();
            SignedJWT jwt = new SignedJWT(header, claims);
            jwt.sign(new RSASSASigner(key));
            return jwt.serialize();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private void serveJwks(String path, RSAKey key) {
        byte[] body = new JWKSet(key.toPublicJWK()).toString().getBytes(StandardCharsets.UTF_8);
        jwksServer.createContext(path, exchange -> {
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
    }

    @Override
    public void close() {
        jwksServer.stop(0);
    }
}
