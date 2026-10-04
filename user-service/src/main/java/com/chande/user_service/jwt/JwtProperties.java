package com.chande.user_service.jwt;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.time.Duration;

@ConfigurationProperties(prefix = "jwt")
@Validated
public record JwtProperties(@NotBlank @Size(min = 32) String secret, @NotBlank String issuer, @NotNull Duration accessTokenTtl, @NotNull Duration refreshTokenTtl) {
}
