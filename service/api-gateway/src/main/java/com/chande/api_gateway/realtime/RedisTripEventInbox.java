package com.chande.api_gateway.realtime;

import org.springframework.core.io.ClassPathResource;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;

/**
 * Chống trùng eventId, bỏ sự kiện có version cũ và đưa sự kiện vào Redis Stream trong cùng một lệnh
 * Lua (nguyên tử). Mọi instance gateway đọc stream này nên app kết nối vào instance nào cũng nhận được.
 * Lưu ý: "bền vững" phụ thuộc cấu hình Redis — production cần bật AOF (appendonly yes).
 */
@Component
public class RedisTripEventInbox implements TripEventInbox {

    static final String STREAM_KEY = "gw:trip-events";
    private static final String RECEIPT_KEY_PREFIX = "gw:trip-event:";
    private static final String VERSION_KEY_PREFIX = "gw:trip-version:";
    private static final RedisScript<String> STORE_SCRIPT =
            RedisScript.of(new ClassPathResource("redis/store-trip-event.lua"), String.class);

    private final StringRedisTemplate redis;
    private final RealtimeProperties properties;

    public RedisTripEventInbox(StringRedisTemplate redis, RealtimeProperties properties) {
        this.redis = redis;
        this.properties = properties;
    }

    @Override
    public Outcome store(TripEvent event) {
        String payload = event.toCanonicalJson();
        String result = redis.execute(STORE_SCRIPT,
                List.of(RECEIPT_KEY_PREFIX + event.eventId(), VERSION_KEY_PREFIX + event.tripId(), STREAM_KEY),
                sha256(payload),
                String.valueOf(event.tripVersion()),
                String.valueOf(properties.eventRetention().toSeconds()),
                String.valueOf(properties.streamMaxLength()),
                payload,
                event.riderId().toString(),
                event.driverId() == null ? "" : event.driverId().toString());
        return Outcome.valueOf(result);
    }

    private static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
