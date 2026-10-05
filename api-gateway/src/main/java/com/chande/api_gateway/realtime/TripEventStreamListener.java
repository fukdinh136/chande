package com.chande.api_gateway.realtime;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.SmartLifecycle;
import org.springframework.data.domain.Range;
import org.springframework.data.redis.connection.Limit;
import org.springframework.data.redis.connection.RedisConnection;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.connection.stream.ByteRecord;
import org.springframework.data.redis.connection.stream.ReadOffset;
import org.springframework.data.redis.connection.stream.StreamOffset;
import org.springframework.data.redis.connection.stream.StreamReadOptions;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Mỗi instance gateway đọc Redis Stream sự kiện chuyến và đẩy xuống khách/tài xế đang kết nối vào
 * chính instance đó. Nhờ vậy chạy nhiều instance gateway sau load balancer vẫn đẩy đúng người.
 * Ghi nhớ ID đã đọc nên nếu Redis mất kết nối ngắn, đọc tiếp từ chỗ cũ thay vì mất sự kiện.
 * Redis không chạy thì REST vẫn hoạt động bình thường; vòng lặp tự thử lại với thời gian chờ tăng dần.
 */
@Component
public class TripEventStreamListener implements SmartLifecycle {

    private static final Logger log = LoggerFactory.getLogger(TripEventStreamListener.class);
    private static final byte[] STREAM_KEY = RedisTripEventInbox.STREAM_KEY.getBytes(StandardCharsets.UTF_8);
    private static final Duration BLOCK = Duration.ofSeconds(1);
    private static final long MIN_BACKOFF_MS = 500;
    private static final long MAX_BACKOFF_MS = 30_000;

    private final RedisConnectionFactory connectionFactory;
    private final SessionRegistry sessions;
    private volatile boolean running;
    private Thread worker;

    public TripEventStreamListener(RedisConnectionFactory connectionFactory, SessionRegistry sessions) {
        this.connectionFactory = connectionFactory;
        this.sessions = sessions;
    }

    @Override
    public void start() {
        running = true;
        worker = Thread.ofVirtual().name("trip-event-stream").start(this::pollLoop);
    }

    @Override
    public void stop() {
        running = false;
        if (worker != null) {
            worker.interrupt();
            try {
                worker.join(Duration.ofSeconds(3));
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    @Override
    public boolean isRunning() {
        return running;
    }

    private void pollLoop() {
        RedisConnection connection = null;
        String lastId = null;
        long backoff = MIN_BACKOFF_MS;
        boolean failing = false;
        while (running) {
            try {
                if (connection == null) {
                    // Giữ một kết nối riêng cho lệnh XREAD BLOCK, không chặn các lệnh Redis khác
                    connection = connectionFactory.getConnection();
                }
                if (lastId == null) {
                    lastId = latestId(connection);
                }
                List<ByteRecord> records = connection.streamCommands().xRead(
                        StreamReadOptions.empty().count(100).block(BLOCK),
                        StreamOffset.create(STREAM_KEY, ReadOffset.from(lastId)));
                if (records != null) {
                    for (ByteRecord record : records) {
                        deliver(record);
                        lastId = record.getId().getValue();
                    }
                }
                if (failing) {
                    log.info("Đã kết nối lại Redis, tiếp tục nhận sự kiện chuyến");
                    failing = false;
                }
                backoff = MIN_BACKOFF_MS;
            } catch (RuntimeException e) {
                if (!running) {
                    break;
                }
                if (!failing) {
                    log.warn("Không đọc được sự kiện chuyến từ Redis, sẽ thử lại: {}", e.getMessage());
                    failing = true;
                }
                closeQuietly(connection);
                connection = null;
                if (!sleep(backoff)) {
                    break;
                }
                backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
            }
        }
        closeQuietly(connection);
    }

    /** Bắt đầu từ sự kiện mới nhất hiện có: sự kiện cũ hơn lúc khởi động thì app tự đồng bộ bằng GET. */
    private static String latestId(RedisConnection connection) {
        List<ByteRecord> last = connection.streamCommands()
                .xRevRange(STREAM_KEY, Range.unbounded(), Limit.limit().count(1));
        return last == null || last.isEmpty() ? "0-0" : last.getFirst().getId().getValue();
    }

    private void deliver(ByteRecord record) {
        Map<String, String> fields = new HashMap<>();
        record.getValue().forEach((k, v) ->
                fields.put(new String(k, StandardCharsets.UTF_8), new String(v, StandardCharsets.UTF_8)));
        String event = fields.get("event");
        if (event == null) {
            return;
        }
        String message = "{\"type\":\"trip.event\",\"event\":" + event + "}";
        int sent = sessions.send(SessionRegistry.userKey("RIDER", fields.get("rider")), message);
        String driver = fields.get("driver");
        if (driver != null && !driver.isEmpty()) {
            sent += sessions.send(SessionRegistry.userKey("DRIVER", driver), message);
        }
        log.debug("Đẩy sự kiện {} tới {} kết nối", record.getId().getValue(), sent);
    }

    private static boolean sleep(long millis) {
        try {
            Thread.sleep(millis);
            return true;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    private static void closeQuietly(RedisConnection connection) {
        if (connection != null) {
            try {
                connection.close();
            } catch (RuntimeException ignored) {
                // kết nối đã hỏng
            }
        }
    }
}
