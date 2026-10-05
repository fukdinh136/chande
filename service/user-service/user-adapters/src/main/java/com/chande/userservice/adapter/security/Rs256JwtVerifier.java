package com.chande.userservice.adapter.security;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.Signature;
import java.security.interfaces.RSAPublicKey;
import java.time.Clock;
import java.time.Duration;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Kiểm access JWT (BR-31). Từ chối: alg khác RS256 (kể cả none/HS256), kid lạ, sai chữ ký, sai iss, thiếu hoặc
 * quá hạn exp (cho lệch đồng hồ {@code clockSkew}), nbf ở tương lai, sub không phải UUID.
 * Không kiểm role: cửa vào HTTP quyết định 403 khi role khác RIDER.
 */
public final class Rs256JwtVerifier {

    public record VerifiedToken(UUID subject, String role) {
    }

    /** Lỗi token; message chỉ để ghi log debug, không trả cho client. */
    public static final class InvalidTokenException extends RuntimeException {
        InvalidTokenException(String message) {
            super(message, null, false, false);
        }
    }

    private static final int MAX_TOKEN_LENGTH = 8192;
    private static final Set<String> ACCEPTED_TYP = Set.of("jwt", "at+jwt", "application/at+jwt");
    private static final Pattern CANONICAL_UUID =
            Pattern.compile("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");

    private final Map<String, RSAPublicKey> keys;
    private final String issuer;
    private final long skewSeconds;
    private final Clock clock;

    public Rs256JwtVerifier(Map<String, RSAPublicKey> keys, String issuer, Duration clockSkew, Clock clock) {
        this.keys = Map.copyOf(keys);
        this.issuer = Objects.requireNonNull(issuer);
        this.skewSeconds = clockSkew.toSeconds();
        this.clock = Objects.requireNonNull(clock);
    }

    public VerifiedToken verify(String token) {
        if (token == null || token.isEmpty() || token.length() > MAX_TOKEN_LENGTH) {
            throw new InvalidTokenException("missing or oversized token");
        }
        String[] parts = token.split("\\.", -1);
        if (parts.length != 3) {
            throw new InvalidTokenException("not a JWS compact token");
        }

        Map<String, Object> header = decodeObject(parts[0], "header");
        if (!"RS256".equals(header.get("alg"))) {
            throw new InvalidTokenException("unsupported alg " + header.get("alg"));
        }
        if (header.containsKey("crit")) {
            throw new InvalidTokenException("crit header not supported");
        }
        Object typ = header.get("typ");
        if (typ != null && !(typ instanceof String t && ACCEPTED_TYP.contains(t.toLowerCase()))) {
            throw new InvalidTokenException("unsupported typ " + typ);
        }
        RSAPublicKey key = header.get("kid") instanceof String kid ? keys.get(kid) : null;
        if (key == null) {
            throw new InvalidTokenException("unknown kid " + header.get("kid"));
        }
        verifySignature(key, parts[0] + "." + parts[1], parts[2]);

        Map<String, Object> claims = decodeObject(parts[1], "payload");
        if (!issuer.equals(claims.get("iss"))) {
            throw new InvalidTokenException("wrong issuer " + claims.get("iss"));
        }
        long now = clock.instant().getEpochSecond();
        Long exp = numericDate(claims.get("exp"));
        if (exp == null) {
            throw new InvalidTokenException("missing exp");
        }
        if (now - skewSeconds > exp) {
            throw new InvalidTokenException("expired");
        }
        if (claims.containsKey("nbf")) {
            Long nbf = numericDate(claims.get("nbf"));
            if (nbf == null || now + skewSeconds < nbf) {
                throw new InvalidTokenException("not yet valid");
            }
        }
        if (!(claims.get("sub") instanceof String sub) || !CANONICAL_UUID.matcher(sub).matches()) {
            throw new InvalidTokenException("sub is not a UUID");
        }
        return new VerifiedToken(UUID.fromString(sub), claims.get("role") instanceof String role ? role : null);
    }

    private static Map<String, Object> decodeObject(String part, String what) {
        try {
            return JwtCodec.decodeJsonObject(part);
        } catch (RuntimeException e) {
            throw new InvalidTokenException("malformed " + what);
        }
    }

    private static void verifySignature(RSAPublicKey key, String signingInput, String encodedSignature) {
        boolean valid;
        try {
            Signature signature = Signature.getInstance("SHA256withRSA");
            signature.initVerify(key);
            signature.update(signingInput.getBytes(StandardCharsets.US_ASCII));
            valid = signature.verify(JwtCodec.decode(encodedSignature));
        } catch (GeneralSecurityException | IllegalArgumentException e) {
            valid = false;
        }
        if (!valid) {
            throw new InvalidTokenException("bad signature");
        }
    }

    private static Long numericDate(Object value) {
        return value instanceof Integer || value instanceof Long ? ((Number) value).longValue() : null;
    }
}
