package com.chande.user_service.auth.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record LoginRequest(
        @NotBlank(message ="Số điện thoại không được để trống")
        @Size(max= 20, message = "Số điện thoại quá dài")
        String phoneNumber,
        @NotBlank(message ="Mật khẩu không được để trống")
        @Size(max= 72, message = "Mật khẩu quá dài")
        String password) {
}
