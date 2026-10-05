package com.chande.api_gateway.internal;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * @param port    cổng riêng cho endpoint nội bộ ({@code /internal/**}); chỉ mở trong mạng private,
 *                không public ra Internet như cổng API
 * @param callers tên service gọi vào → X-Service-Token của service đó (mỗi bên một token riêng)
 */
@ConfigurationProperties(prefix = "gateway.internal")
public record InternalApiProperties(int port, Map<String, String> callers) {

    private static final int MIN_TOKEN_LENGTH = 32;

    public InternalApiProperties {
        if (port < 1 || port > 65535) {
            throw new IllegalStateException("gateway.internal.port không hợp lệ: " + port);
        }
        if (callers == null || callers.isEmpty()) {
            throw new IllegalStateException("Thiếu gateway.internal.callers");
        }
        Set<String> tokens = new HashSet<>();
        callers.forEach((caller, token) -> {
            if (token == null || token.length() < MIN_TOKEN_LENGTH) {
                throw new IllegalStateException("Token của " + caller + " phải dài ít nhất " + MIN_TOKEN_LENGTH + " ký tự");
            }
            if (!tokens.add(token)) {
                throw new IllegalStateException("Mỗi service phải có token riêng, không dùng chung");
            }
        });
        callers = Map.copyOf(callers);
    }
}
