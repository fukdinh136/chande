package com.chande.api_gateway.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

@ConfigurationProperties(prefix = "cors")
public record CorsProperties(List<String> allowedOrigins) {

    public CorsProperties {
        if (allowedOrigins == null || allowedOrigins.isEmpty()) {
            throw new IllegalStateException("Thiếu cors.allowed-origins");
        }
        if (allowedOrigins.contains("*")) {
            throw new IllegalStateException("Không dùng '*' cho cors.allowed-origins, hãy liệt kê origin cụ thể");
        }
        allowedOrigins = List.copyOf(allowedOrigins);
    }
}