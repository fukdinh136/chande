package com.chande.userservice.adapter.http;

import java.util.LinkedHashMap;
import java.util.Map;

/** Kết quả handler: status, body (serialize thành JSON; null = không có body) và header thêm. */
public record HttpResult(int status, Object body, Map<String, String> headers) {

    public HttpResult {
        headers = Map.copyOf(headers);
    }

    public static HttpResult ok(Object body) {
        return new HttpResult(200, body, Map.of());
    }

    public static HttpResult created(Object body) {
        return new HttpResult(201, body, Map.of());
    }

    public static HttpResult noContent() {
        return new HttpResult(204, null, Map.of());
    }

    public static HttpResult of(int status, Object body) {
        return new HttpResult(status, body, Map.of());
    }

    public HttpResult withHeader(String name, String value) {
        Map<String, String> copy = new LinkedHashMap<>(headers);
        copy.put(name, value);
        return new HttpResult(status, body, copy);
    }
}
