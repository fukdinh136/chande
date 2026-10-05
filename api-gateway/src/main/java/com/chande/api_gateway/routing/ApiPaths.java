package com.chande.api_gateway.routing;

/**
 * Quy ước đường dẫn chung của các tài liệu API: route public tại gateway có thêm {@code /api/v1},
 * gateway bỏ prefix này khi chuyển tiếp ({@code /api/v1/trips/active} → {@code /trips/active}).
 */
public final class ApiPaths {

    public static final String PREFIX = "/api/v1";
    static final int PREFIX_SEGMENTS = 2;

    private ApiPaths() {
    }
}
