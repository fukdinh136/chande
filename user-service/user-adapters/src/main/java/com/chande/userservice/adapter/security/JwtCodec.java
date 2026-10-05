package com.chande.userservice.adapter.security;

import tools.jackson.core.StreamReadFeature;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

import java.util.Base64;
import java.util.Map;

/** Base64url + JSON cho phần header/payload của JWT. */
final class JwtCodec {

    private static final JsonMapper MAPPER = JsonMapper.builder()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION) // {"alg":"RS256","alg":"none"} bị từ chối
            .build();
    private static final TypeReference<Map<String, Object>> OBJECT = new TypeReference<>() {
    };
    private static final Base64.Encoder ENCODER = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder DECODER = Base64.getUrlDecoder();

    private JwtCodec() {
    }

    static String encode(byte[] bytes) {
        return ENCODER.encodeToString(bytes);
    }

    static String encodeJson(Map<String, Object> value) {
        return encode(MAPPER.writeValueAsBytes(value));
    }

    /** @throws IllegalArgumentException nếu không phải base64url không padding */
    static byte[] decode(String part) {
        if (part.isEmpty() || part.indexOf('=') >= 0) {
            throw new IllegalArgumentException("invalid base64url");
        }
        return DECODER.decode(part);
    }

    /** @throws RuntimeException nếu không phải JSON object */
    static Map<String, Object> decodeJsonObject(String part) {
        Map<String, Object> value = MAPPER.readValue(decode(part), OBJECT);
        if (value == null) {
            throw new IllegalArgumentException("not a JSON object");
        }
        return value;
    }
}
