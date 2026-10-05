package com.chande.userservice.application.profile;

import com.chande.userservice.domain.common.FieldErrors;

import java.util.regex.Pattern;

/** P2. Cả hai trường tuỳ chọn; null nghĩa là giữ nguyên. */
public record UpdateProfileCommand(String fullName, String avatarUrl) {

    private static final Pattern NOT_BLANK = Pattern.compile(".*\\S.*");
    private static final Pattern HTTP_URL = Pattern.compile("^https?://\\S+$");

    public UpdateProfileCommand {
        new FieldErrors()
                .maxLength("fullName", fullName, 100, "Họ tên tối đa 100 ký tự")
                .matches("fullName", fullName, NOT_BLANK, "Họ tên không được để trống")
                .maxLength("avatarUrl", avatarUrl, 500, "URL ảnh tối đa 500 ký tự")
                .matches("avatarUrl", avatarUrl, HTTP_URL, "URL ảnh phải bắt đầu bằng http:// hoặc https://")
                .throwIfAny();
    }
}
