package com.chande.api_gateway.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.nio.charset.StandardCharsets;
import java.util.List;

@ConfigurationProperties(prefix = "jwt")
public record JwtProperties(String secret, List<String> allowedIssuers) {

    public JwtProperties {
        if (secret == null || secret.getBytes(StandardCharsets.UTF_8).length < 32) {
            throw new IllegalStateException("jwt.secret phải dài ít nhất 32 byte (yêu cầu của HS256)");
        }
        if (allowedIssuers == null || allowedIssuers.isEmpty()) {
            throw new IllegalStateException("Thiếu jwt.allowed-issuers");
        }
        allowedIssuers = List.copyOf(allowedIssuers);
    }
}