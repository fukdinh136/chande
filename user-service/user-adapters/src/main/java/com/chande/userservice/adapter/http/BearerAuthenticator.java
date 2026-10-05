package com.chande.userservice.adapter.http;

import com.chande.userservice.adapter.security.Rs256JwtVerifier;
import com.sun.net.httpserver.Headers;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Xác thực route RIDER. Service tự kiểm JWT, không tin gateway, vì có thể bị gọi thẳng trong mạng nội bộ.
 * Sai/thiếu token: 401; token hợp lệ nhưng role khác RIDER: 403.
 */
public final class BearerAuthenticator {

    private static final Logger log = LoggerFactory.getLogger(BearerAuthenticator.class);
    /** Scheme "Bearer" không phân biệt hoa thường (giống BearerTokenResolver của Spring ở v1). */
    private static final Pattern BEARER = Pattern.compile("^Bearer +([A-Za-z0-9\\-._~+/]+=*)$", Pattern.CASE_INSENSITIVE);
    private static final String ROLE_RIDER = "RIDER";

    private final Rs256JwtVerifier verifier;

    public BearerAuthenticator(Rs256JwtVerifier verifier) {
        this.verifier = verifier;
    }

    /** @return {@code sub} của token */
    public UUID authenticate(Headers headers) {
        List<String> values = headers.get("Authorization");
        if (values == null || values.size() != 1) {
            throw HttpError.authenticationRequired();
        }
        Matcher matcher = BEARER.matcher(values.getFirst());
        if (!matcher.matches()) {
            throw HttpError.authenticationRequired();
        }
        Rs256JwtVerifier.VerifiedToken token;
        try {
            token = verifier.verify(matcher.group(1));
        } catch (Rs256JwtVerifier.InvalidTokenException e) {
            log.debug("Access token rejected: {}", e.getMessage());
            throw HttpError.authenticationRequired();
        }
        if (!ROLE_RIDER.equals(token.role())) {
            throw HttpError.accessDenied();
        }
        return token.subject();
    }
}
