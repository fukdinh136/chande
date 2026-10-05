package com.chande.userservice.adapter.http;

import com.sun.net.httpserver.Headers;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Xác thực route INTERNAL bằng {@code X-Internal-Key}, so sánh thời gian hằng. JWT người dùng không thay được khoá này. */
public final class InternalKeyAuthenticator {

    static final String HEADER = "X-Internal-Key";

    private final byte[] expected;

    public InternalKeyAuthenticator(String internalApiKey) {
        this.expected = internalApiKey.getBytes(StandardCharsets.UTF_8);
    }

    public void authenticate(Headers headers) {
        String provided = headers.getFirst(HEADER);
        if (provided == null || !MessageDigest.isEqual(provided.getBytes(StandardCharsets.UTF_8), expected)) {
            throw HttpError.authenticationRequired();
        }
    }
}
