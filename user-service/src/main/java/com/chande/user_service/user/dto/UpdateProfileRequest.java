package com.chande.user_service.user.dto;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record UpdateProfileRequest(
        @Size(max = 100, message = "Họ tên tối đa 100 ký tự")
        @Pattern(regexp = ".*\\S.*", message = "Họ tên không được để trống")
        String fullName,

        @Size(max = 500, message = "URL ảnh tối đa 500 ký tự")
        @Pattern(regexp = "^https?://\\S+$", message = "URL ảnh phải bắt đầu bằng http:// hoặc https://")
        String avatarUrl
) {}