package com.chande.api_gateway.realtime;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * Sự kiện trạng thái chuyến theo envelope ở mục 12 tài liệu Trip (schemaVersion 1).
 * Payload tối thiểu, không có thông tin cá nhân; app đọc chi tiết qua GET /api/v1/trips/:id.
 *
 * @param driverId null khi chuyến chưa có tài xế (trip.searching, hoặc huỷ trước khi gán)
 */
public record TripEvent(UUID eventId, String type, UUID tripId, long tripVersion, Instant occurredAt,
                        UUID riderId, UUID driverId, String status) {

    public static final int SCHEMA_VERSION = 1;

    /** Bảng event type → trạng thái chuyến ở mục 12 tài liệu Trip. */
    public static final Map<String, String> STATUS_BY_TYPE = Map.of(
            "trip.searching", "SEARCHING",
            "trip.assigned", "ASSIGNED",
            "trip.driver_arrived", "DRIVER_ARRIVED",
            "trip.started", "IN_PROGRESS",
            "trip.completed", "COMPLETED",
            "trip.cancelled", "CANCELLED");

    /**
     * JSON với thứ tự trường cố định. Dùng để băm (cùng nội dung → cùng hash dù Trip định dạng khác,
     * ví dụ "02:02:00Z" và "02:02:00.000Z") và để gửi xuống app. Mọi giá trị đã được kiểm tra
     * (UUID, type/status trong danh sách cố định) nên không cần escape.
     */
    public String toCanonicalJson() {
        return "{\"schemaVersion\":" + SCHEMA_VERSION
                + ",\"eventId\":\"" + eventId
                + "\",\"type\":\"" + type
                + "\",\"tripId\":\"" + tripId
                + "\",\"tripVersion\":" + tripVersion
                + ",\"occurredAt\":\"" + occurredAt
                + "\",\"data\":{\"riderId\":\"" + riderId
                + "\",\"driverId\":" + (driverId == null ? "null" : "\"" + driverId + "\"")
                + ",\"status\":\"" + status + "\"}}";
    }
}
