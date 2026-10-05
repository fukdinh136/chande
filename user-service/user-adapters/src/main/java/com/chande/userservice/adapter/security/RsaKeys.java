package com.chande.userservice.adapter.security;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.interfaces.RSAPrivateCrtKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.RSAPublicKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Khoá RSA ký access token (BR-30, BR-33): một khoá hiện hành (private, PKCS#8 PEM) và các public key cũ
 * (X.509 PEM, tên file = kid) còn trong thời gian chuyển tiếp. Đọc một lần lúc khởi động.
 */
public final class RsaKeys {

    public static final int MIN_KEY_BITS = 2048;

    public record SigningKey(String kid, RSAPrivateCrtKey privateKey, RSAPublicKey publicKey) {
    }

    private final SigningKey current;
    private final Map<String, RSAPublicKey> all;
    private final JwksDocument jwks;

    private RsaKeys(SigningKey current, Map<String, RSAPublicKey> previous) {
        this.current = current;
        Map<String, RSAPublicKey> keys = new LinkedHashMap<>();
        keys.put(current.kid(), current.publicKey());
        previous.forEach((kid, key) -> {
            if (keys.putIfAbsent(kid, key) != null) {
                throw new IllegalStateException("Duplicate JWT key id: " + kid);
            }
            requireStrength(kid, key);
        });
        this.all = Collections.unmodifiableMap(keys);
        this.jwks = JwksDocument.of(all);
    }

    /**
     * @param privateKeyFile    RSA private key, PKCS#8 PEM ({@code -----BEGIN PRIVATE KEY-----})
     * @param keyId             kid của khoá hiện hành
     * @param previousKeysDir   thư mục chứa public key cũ ({@code <kid>.pem}); null nếu không có
     */
    public static RsaKeys load(Path privateKeyFile, String keyId, Path previousKeysDir) {
        try {
            RSAPrivateCrtKey privateKey = parsePrivateKey(Files.readString(privateKeyFile, StandardCharsets.US_ASCII));
            Map<String, RSAPublicKey> previous = new LinkedHashMap<>();
            if (previousKeysDir != null) {
                List<Path> files = new ArrayList<>();
                try (DirectoryStream<Path> stream = Files.newDirectoryStream(previousKeysDir, "*.pem")) {
                    stream.forEach(files::add);
                }
                files.sort(null);
                for (Path file : files) {
                    String name = file.getFileName().toString();
                    String kid = name.substring(0, name.length() - ".pem".length());
                    previous.put(kid, parsePublicKey(Files.readString(file, StandardCharsets.US_ASCII)));
                }
            }
            return of(keyId, privateKey, previous);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read JWT key files: " + e.getMessage(), e);
        }
    }

    public static RsaKeys of(String keyId, RSAPrivateCrtKey privateKey, Map<String, RSAPublicKey> previous) {
        if (keyId == null || keyId.isBlank()) {
            throw new IllegalStateException("JWT key id must not be blank");
        }
        RSAPublicKey publicKey = publicKeyOf(privateKey);
        requireStrength(keyId, publicKey);
        return new RsaKeys(new SigningKey(keyId, privateKey, publicKey), previous);
    }

    public SigningKey current() {
        return current;
    }

    /** kid -> public key, gồm cả khoá hiện hành. */
    public Map<String, RSAPublicKey> all() {
        return all;
    }

    public JwksDocument jwks() {
        return jwks;
    }

    static RSAPrivateCrtKey parsePrivateKey(String pem) {
        if (pem.contains("BEGIN RSA PRIVATE KEY")) {
            throw new IllegalStateException("JWT private key is PKCS#1; convert it to PKCS#8: "
                    + "openssl pkcs8 -topk8 -nocrypt -in key.pem -out key-pkcs8.pem");
        }
        try {
            byte[] der = pemBody(pem, "PRIVATE KEY");
            if (KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(der)) instanceof RSAPrivateCrtKey key) {
                return key;
            }
            throw new IllegalStateException("JWT private key must be an RSA CRT key");
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Invalid RSA private key: " + e.getMessage(), e);
        }
    }

    static RSAPublicKey parsePublicKey(String pem) {
        try {
            byte[] der = pemBody(pem, "PUBLIC KEY");
            return (RSAPublicKey) KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(der));
        } catch (GeneralSecurityException | ClassCastException e) {
            throw new IllegalStateException("Invalid RSA public key: " + e.getMessage(), e);
        }
    }

    private static RSAPublicKey publicKeyOf(RSAPrivateCrtKey key) {
        try {
            return (RSAPublicKey) KeyFactory.getInstance("RSA")
                    .generatePublic(new RSAPublicKeySpec(key.getModulus(), key.getPublicExponent()));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Cannot derive RSA public key", e);
        }
    }

    private static void requireStrength(String kid, RSAPublicKey key) {
        if (key.getModulus().bitLength() < MIN_KEY_BITS) {
            throw new IllegalStateException("JWT key '" + kid + "' must be at least " + MIN_KEY_BITS + " bits");
        }
    }

    private static byte[] pemBody(String pem, String type) {
        String begin = "-----BEGIN " + type + "-----";
        String end = "-----END " + type + "-----";
        int from = pem.indexOf(begin);
        int to = pem.indexOf(end);
        if (from < 0 || to < from) {
            throw new IllegalStateException("Expected PEM block '" + begin + "'");
        }
        String base64 = pem.substring(from + begin.length(), to).replaceAll("\\s", "");
        return Base64.getDecoder().decode(Objects.requireNonNull(base64));
    }
}
