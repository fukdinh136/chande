package com.chande.api_gateway.realtime;

import java.time.Instant;
import java.util.UUID;

/**
 * Vị trí tài xế nhận qua WebSocket. {@code driverId} lấy từ JWT đã xác thực, không lấy từ tin nhắn.
 *
 * @param heading    hướng di chuyển (độ, 0–360), có thể null
 * @param speed      tốc độ (m/s), có thể null
 * @param accuracy   sai số GPS (mét), có thể null
 * @param recordedAt thời điểm thiết bị ghi nhận, có thể null
 * @param receivedAt thời điểm gateway nhận (đồng hồ server)
 */
public record DriverLocation(UUID driverId, double lat, double lng, Double heading, Double speed,
                             Double accuracy, Instant recordedAt, Instant receivedAt) {
}
