package com.chande.userservice.adapter.security;

import java.math.BigInteger;
import java.security.interfaces.RSAPublicKey;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.Map;

/** Nội dung {@code /.well-known/jwks.json}: chỉ public key (khoá đang ký + khoá cũ còn trong thời gian chuyển tiếp). */
public record JwksDocument(List<Jwk> keys) {

    public record Jwk(String kty, String use, String alg, String kid, String n, String e) {
    }

    static JwksDocument of(Map<String, RSAPublicKey> publicKeys) {
        return new JwksDocument(publicKeys.entrySet().stream()
                .map(entry -> new Jwk("RSA", "sig", "RS256", entry.getKey(),
                        unsignedBase64Url(entry.getValue().getModulus()),
                        unsignedBase64Url(entry.getValue().getPublicExponent())))
                .toList());
    }

    /** Byte big-endian không dấu: {@code BigInteger.toByteArray()} có thể thêm một byte 0x00 ở đầu, phải bỏ đi. */
    static String unsignedBase64Url(BigInteger value) {
        byte[] bytes = value.toByteArray();
        if (bytes.length > 1 && bytes[0] == 0) {
            bytes = Arrays.copyOfRange(bytes, 1, bytes.length);
        }
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
