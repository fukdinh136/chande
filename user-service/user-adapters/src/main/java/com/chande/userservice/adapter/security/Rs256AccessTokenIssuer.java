package com.chande.userservice.adapter.security;

import com.chande.userservice.application.port.AccessTokenIssuer;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.Signature;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/** Access JWT RS256 (mục 7): header {alg, typ: at+jwt, kid}; payload {iss, sub, [aud], role, iat, exp, jti}. */
public final class Rs256AccessTokenIssuer implements AccessTokenIssuer {

    public static final String ROLE_RIDER = "RIDER";

    private final RsaKeys.SigningKey key;
    private final String issuer;
    private final List<String> audience;
    private final long ttlSeconds;
    private final String encodedHeader;

    public Rs256AccessTokenIssuer(RsaKeys.SigningKey key, String issuer, List<String> audience, Duration ttl) {
        this.key = Objects.requireNonNull(key);
        this.issuer = Objects.requireNonNull(issuer);
        this.audience = List.copyOf(audience);
        this.ttlSeconds = ttl.toSeconds();
        Map<String, Object> header = new LinkedHashMap<>();
        header.put("alg", "RS256");
        header.put("typ", "at+jwt");
        header.put("kid", key.kid());
        this.encodedHeader = JwtCodec.encodeJson(header);
    }

    @Override
    public AccessToken issue(UUID userId, Instant now) {
        long iat = now.getEpochSecond();
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("iss", issuer);
        payload.put("sub", userId.toString());
        if (!audience.isEmpty()) {
            payload.put("aud", audience);
        }
        payload.put("role", ROLE_RIDER);
        payload.put("iat", iat);
        payload.put("exp", iat + ttlSeconds);
        payload.put("jti", UUID.randomUUID().toString());

        String signingInput = encodedHeader + "." + JwtCodec.encodeJson(payload);
        try {
            Signature signature = Signature.getInstance("SHA256withRSA"); // không thread-safe: tạo mới mỗi lần
            signature.initSign(key.privateKey());
            signature.update(signingInput.getBytes(StandardCharsets.US_ASCII));
            return new AccessToken(signingInput + "." + JwtCodec.encode(signature.sign()), ttlSeconds);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Cannot sign access token", e);
        }
    }
}
