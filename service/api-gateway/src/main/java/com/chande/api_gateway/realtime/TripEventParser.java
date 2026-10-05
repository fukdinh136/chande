package com.chande.api_gateway.realtime;

import com.chande.api_gateway.error.ErrorCode;
import com.chande.api_gateway.error.ErrorDetail;
import com.chande.api_gateway.error.GatewayException;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Kiểm tra chặt envelope sự kiện chuyến: sai kiểu, thiếu trường hoặc có trường lạ đều trả 400
 * kèm danh sách trường lỗi (không phản chiếu giá trị đã gửi).
 */
@Component
public class TripEventParser {

    private static final Set<String> TOP_LEVEL_FIELDS =
            Set.of("schemaVersion", "eventId", "type", "tripId", "tripVersion", "occurredAt", "data");
    private static final Set<String> DATA_FIELDS = Set.of("riderId", "driverId", "status");
    /** Các trạng thái chắc chắn đã có tài xế được gán. */
    private static final Set<String> TYPES_WITH_DRIVER =
            Set.of("trip.assigned", "trip.driver_arrived", "trip.started", "trip.completed");
    private static final Pattern UUID_PATTERN = Pattern.compile(
            "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");

    private final JsonMapper jsonMapper;

    public TripEventParser(JsonMapper jsonMapper) {
        this.jsonMapper = jsonMapper;
    }

    public TripEvent parse(byte[] body) {
        JsonNode root;
        try {
            root = jsonMapper.readTree(body);
        } catch (JacksonException e) {
            throw invalid(List.of(new ErrorDetail("body", "không phải JSON hợp lệ")));
        }
        if (root == null || !root.isObject()) {
            throw invalid(List.of(new ErrorDetail("body", "phải là JSON object")));
        }

        List<ErrorDetail> errors = new ArrayList<>();
        rejectUnknownFields(root, TOP_LEVEL_FIELDS, "", errors);

        JsonNode schemaVersion = root.get("schemaVersion");
        if (schemaVersion == null || !schemaVersion.isIntegralNumber() || schemaVersion.asLong() != TripEvent.SCHEMA_VERSION) {
            errors.add(new ErrorDetail("schemaVersion", "phải là 1"));
        }
        UUID eventId = uuid(root, "eventId", "eventId", errors);
        String type = text(root, "type");
        if (type == null || !TripEvent.STATUS_BY_TYPE.containsKey(type)) {
            errors.add(new ErrorDetail("type", "không thuộc danh sách sự kiện chuyến"));
        }
        UUID tripId = uuid(root, "tripId", "tripId", errors);
        JsonNode tripVersionNode = root.get("tripVersion");
        long tripVersion = 0;
        if (tripVersionNode == null || !tripVersionNode.isIntegralNumber() || !tripVersionNode.canConvertToLong()
                || tripVersionNode.asLong() < 1) {
            errors.add(new ErrorDetail("tripVersion", "phải là số nguyên >= 1"));
        } else {
            tripVersion = tripVersionNode.asLong();
        }
        Instant occurredAt = instant(root, "occurredAt", errors);

        UUID riderId = null;
        UUID driverId = null;
        String status = null;
        JsonNode data = root.get("data");
        if (data == null || !data.isObject()) {
            errors.add(new ErrorDetail("data", "phải là JSON object"));
        } else {
            rejectUnknownFields(data, DATA_FIELDS, "data.", errors);
            riderId = uuid(data, "riderId", "data.riderId", errors);
            JsonNode driverNode = data.get("driverId");
            if (driverNode != null && !driverNode.isNull()) {
                driverId = uuid(data, "driverId", "data.driverId", errors);
            } else if (type != null && TYPES_WITH_DRIVER.contains(type)) {
                errors.add(new ErrorDetail("data.driverId", "bắt buộc với " + type));
            }
            status = text(data, "status");
            String expected = type == null ? null : TripEvent.STATUS_BY_TYPE.get(type);
            if (status == null || (expected != null && !expected.equals(status))) {
                errors.add(new ErrorDetail("data.status", "không khớp với type"));
            }
        }

        if (!errors.isEmpty()) {
            throw invalid(errors);
        }
        return new TripEvent(eventId, type, tripId, tripVersion, occurredAt, riderId, driverId, status);
    }

    private static void rejectUnknownFields(JsonNode node, Set<String> allowed, String prefix, List<ErrorDetail> errors) {
        for (String name : node.propertyNames()) {
            if (!allowed.contains(name)) {
                errors.add(new ErrorDetail(prefix + name, "trường không được hỗ trợ"));
            }
        }
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value != null && value.isString() ? value.asString() : null;
    }

    private static UUID uuid(JsonNode node, String field, String path, List<ErrorDetail> errors) {
        String value = text(node, field);
        if (value == null || !UUID_PATTERN.matcher(value).matches()) {
            errors.add(new ErrorDetail(path, "phải là UUID"));
            return null;
        }
        return UUID.fromString(value);
    }

    private static Instant instant(JsonNode node, String field, List<ErrorDetail> errors) {
        String value = text(node, field);
        try {
            if (value != null) {
                return Instant.parse(value);
            }
        } catch (DateTimeParseException ignored) {
            // rơi xuống báo lỗi
        }
        errors.add(new ErrorDetail(field, "phải là thời gian ISO 8601"));
        return null;
    }

    private static GatewayException invalid(List<ErrorDetail> details) {
        return new GatewayException(ErrorCode.INVALID_REQUEST, details);
    }
}
