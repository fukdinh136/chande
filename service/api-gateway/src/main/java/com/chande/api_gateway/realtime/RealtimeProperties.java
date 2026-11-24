package com.chande.api_gateway.realtime;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.util.unit.DataSize;

import java.time.Duration;

/**
 * @param authTimeout         kết nối WebSocket chưa xác thực sau khoảng này thì bị đóng
 * @param idleTimeout         không nhận/gửi gì trong khoảng này thì đóng (client nên gửi ping mỗi ~25 giây)
 * @param maxSessionsPerUser  số kết nối WebSocket tối đa của một tài khoản (nhiều thiết bị)
 * @param locationMinInterval tài xế gửi vị trí dày hơn mức này thì gateway bỏ bớt
 * @param maxMessageSize      kích thước tối đa một tin nhắn từ client
 * @param eventRetention      thời gian giữ receipt chống trùng eventId và version mới nhất của chuyến. Mặc định 24 giờ,
 *                            khớp thời gian Trip giữ outbox; Gateway sập lâu hơn thế thì event Trip gửi lại muộn có
 *                            thể bị đẩy lần hai
 * @param streamMaxLength     số sự kiện tối đa giữ trong Redis Stream
 * @param maxSessions         số kết nối /ws tối đa trên một instance; vượt thì từ chối ngay (4503 SERVER_BUSY) thay vì
 *                            để instance hết bộ nhớ. Đo 2026-11-17 (đã tắt nén permessage-deflate): 768 MiB giữ
 *                            khoảng 5800 phiên kèm 32 chuyến/giây, bộ nhớ cao nhất 763 MB trên 805 MB
 */
@ConfigurationProperties(prefix = "gateway.realtime")
public record RealtimeProperties(
        @DefaultValue("10s") Duration authTimeout,
        @DefaultValue("60s") Duration idleTimeout,
        @DefaultValue("5") int maxSessionsPerUser,
        @DefaultValue("1s") Duration locationMinInterval,
        @DefaultValue("4KB") DataSize maxMessageSize,
        @DefaultValue("24h") Duration eventRetention,
        @DefaultValue("100000") long streamMaxLength,
        @DefaultValue("6000") int maxSessions) {

    public RealtimeProperties {
        if (maxSessions < 1) {
            throw new IllegalStateException("gateway.realtime.max-sessions phải >= 1");
        }
        if (maxSessionsPerUser < 1) {
            throw new IllegalStateException("gateway.realtime.max-sessions-per-user phải >= 1");
        }
        if (eventRetention.toSeconds() < 1 || streamMaxLength < 1) {
            throw new IllegalStateException("gateway.realtime.event-retention và stream-max-length phải > 0");
        }
    }
}
