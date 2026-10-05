package com.chande.userservice.domain.common;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Gom lỗi theo trường. Mỗi trường chỉ giữ lỗi đầu tiên, nên gọi theo thứ tự: bắt buộc -> độ dài -> mẫu/khoảng.
 * <ul>
 *   <li>"Bắt buộc" với chuỗi: khác null và không rỗng sau {@code trim()} (giống {@code @NotBlank} của v1).</li>
 *   <li>Độ dài tính trên giá trị gốc, chưa trim.</li>
 *   <li>Giá trị null bỏ qua mọi kiểm tra trừ "bắt buộc".</li>
 * </ul>
 */
public final class FieldErrors {

    private final Map<String, String> errors = new LinkedHashMap<>();

    public FieldErrors required(String field, String value, String message) {
        if (value == null || value.trim().isEmpty()) {
            add(field, message);
        }
        return this;
    }

    public FieldErrors required(String field, Object value, String message) {
        if (value == null) {
            add(field, message);
        }
        return this;
    }

    public FieldErrors maxLength(String field, String value, int max, String message) {
        if (value != null && value.length() > max) {
            add(field, message);
        }
        return this;
    }

    public FieldErrors length(String field, String value, int min, int max, String message) {
        if (value != null && (value.length() < min || value.length() > max)) {
            add(field, message);
        }
        return this;
    }

    /** Giới hạn số byte UTF-8 (BCrypt chỉ dùng 72 byte đầu của mật khẩu). */
    public FieldErrors maxUtf8Bytes(String field, String value, int max, String message) {
        if (value != null && value.getBytes(StandardCharsets.UTF_8).length > max) {
            add(field, message);
        }
        return this;
    }

    /** Khớp toàn chuỗi ({@code matcher(value).matches()}). */
    public FieldErrors matches(String field, String value, Pattern pattern, String message) {
        if (value != null && !pattern.matcher(value).matches()) {
            add(field, message);
        }
        return this;
    }

    public FieldErrors between(String field, BigDecimal value, BigDecimal min, BigDecimal max, String message) {
        if (value != null && (value.compareTo(min) < 0 || value.compareTo(max) > 0)) {
            add(field, message);
        }
        return this;
    }

    public void throwIfAny() {
        if (!errors.isEmpty()) {
            throw new ValidationException(errors);
        }
    }

    private void add(String field, String message) {
        errors.putIfAbsent(field, message);
    }
}
