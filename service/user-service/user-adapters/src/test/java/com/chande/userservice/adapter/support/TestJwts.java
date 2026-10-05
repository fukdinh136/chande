package com.chande.userservice.adapter.support;

import tools.jackson.databind.json.JsonMapper;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.PrivateKey;
import java.security.Signature;
import java.util.Base64;
import java.util.Map;

/** Ký JWT tuỳ ý để thử các ca bị từ chối. */
public final class TestJwts {

    private static final JsonMapper MAPPER = JsonMapper.builder().build();
    private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();

    private TestJwts() {
    }

    public static String rs256(PrivateKey key, Map<String, Object> header, Map<String, Object> payload) {
        try {
            String input = encode(header) + "." + encode(payload);
            Signature signature = Signature.getInstance("SHA256withRSA");
            signature.initSign(key);
            signature.update(input.getBytes(StandardCharsets.US_ASCII));
            return input + "." + B64.encodeToString(signature.sign());
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    public static String hs256(byte[] secret, Map<String, Object> header, Map<String, Object> payload) {
        try {
            String input = encode(header) + "." + encode(payload);
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            return input + "." + B64.encodeToString(mac.doFinal(input.getBytes(StandardCharsets.US_ASCII)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    public static String unsigned(Map<String, Object> header, Map<String, Object> payload) {
        return encode(header) + "." + encode(payload) + ".";
    }

    public static Map<String, Object> decodePart(String token, int index) {
        @SuppressWarnings("unchecked")
        Map<String, Object> map = MAPPER.readValue(Base64.getUrlDecoder().decode(token.split("\\.")[index]), Map.class);
        return map;
    }

    private static String encode(Map<String, Object> value) {
        return B64.encodeToString(MAPPER.writeValueAsBytes(value));
    }
}
