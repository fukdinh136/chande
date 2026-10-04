package com.chande.user_service.auth.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record RefreshRequest(
        @NotBlank(message = "Refresh token không được để trống")
        @Size(max = 200, message = "Refresh token không hợp lệ")
        String refreshToken
) {}