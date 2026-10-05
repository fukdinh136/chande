package com.chande.userservice.application.auth;

import com.chande.userservice.domain.common.FieldErrors;

/** A3 (refresh) và A4 (logout). */
public record RefreshCommand(String refreshToken) {

    public RefreshCommand {
        new FieldErrors()
                .required("refreshToken", refreshToken, "Refresh token không được để trống")
                .maxLength("refreshToken", refreshToken, 200, "Refresh token không hợp lệ")
                .throwIfAny();
    }

    @Override
    public String toString() {
        return "RefreshCommand[refreshToken=***]";
    }
}
