package com.chande.user_service.common.security;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@ConfigurationProperties(prefix = "internal")
@Validated
public record InternalApiProperties(
        @NotBlank(message = "Thiếu internal.api-key")
        @Size(min = 16, message = "internal.api-key phải dài ít nhất 16 ký tự")
        String apiKey
) {}