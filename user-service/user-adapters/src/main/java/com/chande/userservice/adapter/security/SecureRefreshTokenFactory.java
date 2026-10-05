package com.chande.userservice.adapter.security;

import com.chande.userservice.application.port.RefreshTokenFactory;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;

/** BR-10: 32 byte SecureRandom -> base64url không padding (43 ký tự); DB lưu sha256Hex của chuỗi đó. */
public final class SecureRefreshTokenFactory implements RefreshTokenFactory {

    private static final Base64.Encoder BASE64URL = Base64.getUrlEncoder().withoutPadding();

    private final SecureRandom random = new SecureRandom();

    @Override
    public NewRefreshToken generate() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String raw = BASE64URL.encodeToString(bytes);
        return new NewRefreshToken(raw, hash(raw));
    }

    /** SHA-256 trên byte UTF-8 của chuỗi, hex chữ thường 64 ký tự (giống v1, nên token cũ vẫn dùng được). */
    @Override
    public String hash(String raw) {
        try {
            // MessageDigest không thread-safe: tạo mới mỗi lần
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(raw.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }
}
