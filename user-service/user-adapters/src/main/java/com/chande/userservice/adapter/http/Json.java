package com.chande.userservice.adapter.http;

import tools.jackson.core.StreamWriteFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.MapperFeature;
import tools.jackson.databind.cfg.CoercionAction;
import tools.jackson.databind.cfg.CoercionInputShape;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.type.LogicalType;

/**
 * Jackson cho body request/response (mục 10.7):
 * <ul>
 *   <li>trường lạ bị bỏ qua;</li>
 *   <li>không ép kiểu vô hướng: chuỗi ở chỗ cần số, số ở chỗ cần chuỗi, số ở chỗ cần boolean... đều là lỗi
 *       (riêng số nguyên ở chỗ cần số thập phân vẫn hợp lệ, ví dụ {@code "lat": 21});</li>
 *   <li>BigDecimal ghi dạng thường ({@code 0.00000000}, không phải {@code 0E-8});</li>
 *   <li>field null vẫn được ghi ra (trừ fieldErrors của body lỗi, xem ErrorJson).</li>
 * </ul>
 */
public final class Json {

    private static final JsonMapper MAPPER = JsonMapper.builder()
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .disable(MapperFeature.ALLOW_COERCION_OF_SCALARS)
            .disable(MapperFeature.SORT_PROPERTIES_ALPHABETICALLY)
            .enable(StreamWriteFeature.WRITE_BIGDECIMAL_AS_PLAIN)
            .withCoercionConfig(LogicalType.Textual, cfg -> cfg
                    .setCoercion(CoercionInputShape.Integer, CoercionAction.Fail)
                    .setCoercion(CoercionInputShape.Float, CoercionAction.Fail)
                    .setCoercion(CoercionInputShape.Boolean, CoercionAction.Fail))
            .withCoercionConfig(LogicalType.Boolean, cfg -> cfg
                    .setCoercion(CoercionInputShape.Integer, CoercionAction.Fail)
                    .setCoercion(CoercionInputShape.Float, CoercionAction.Fail)
                    .setCoercion(CoercionInputShape.String, CoercionAction.Fail)
                    .setCoercion(CoercionInputShape.EmptyString, CoercionAction.Fail))
            .withCoercionConfig(LogicalType.Float, cfg -> cfg
                    .setCoercion(CoercionInputShape.String, CoercionAction.Fail)
                    .setCoercion(CoercionInputShape.EmptyString, CoercionAction.Fail)
                    .setCoercion(CoercionInputShape.Boolean, CoercionAction.Fail))
            .build();

    private Json() {
    }

    /** @throws tools.jackson.core.JacksonException JSON hỏng hoặc sai kiểu */
    public static <T> T read(byte[] body, Class<T> type) {
        return MAPPER.readValue(body, type);
    }

    public static byte[] write(Object value) {
        return MAPPER.writeValueAsBytes(value);
    }
}
