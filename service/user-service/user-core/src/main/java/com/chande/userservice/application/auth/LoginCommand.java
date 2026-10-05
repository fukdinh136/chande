package com.chande.userservice.application.auth;

import com.chande.userservice.domain.common.FieldErrors;

/** A2. Mật khẩu đăng nhập không có độ dài tối thiểu. */
public record LoginCommand(String phoneNumber, String password) {

    public LoginCommand {
        new FieldErrors()
                .required("phoneNumber", phoneNumber, "Số điện thoại không được để trống")
                .maxLength("phoneNumber", phoneNumber, 20, "Số điện thoại quá dài")
                .required("password", password, "Mật khẩu không được để trống")
                .maxLength("password", password, 72, "Mật khẩu quá dài")
                .throwIfAny();
    }

    @Override
    public String toString() {
        return "LoginCommand[phoneNumber=" + phoneNumber + ", password=***]";
    }
}
