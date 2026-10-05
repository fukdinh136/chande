package com.chande.userservice.application.auth;

import com.chande.userservice.domain.common.FieldErrors;

import static com.chande.userservice.domain.user.PasswordPolicy.LETTER_AND_DIGIT;
import static com.chande.userservice.domain.user.PasswordPolicy.MAX_LENGTH;
import static com.chande.userservice.domain.user.PasswordPolicy.MAX_UTF8_BYTES;
import static com.chande.userservice.domain.user.PasswordPolicy.MIN_LENGTH;

/** A1. Tạo được command nghĩa là các trường đã hợp lệ. */
public record RegisterCommand(String phoneNumber, String password, String fullName) {

    public RegisterCommand {
        new FieldErrors()
                .required("phoneNumber", phoneNumber, "Số điện thoại không được để trống")
                .maxLength("phoneNumber", phoneNumber, 20, "Số điện thoại quá dài")
                .required("password", password, "Mật khẩu không được để trống")
                .length("password", password, MIN_LENGTH, MAX_LENGTH, "Mật khẩu phải từ 8 đến 72 ký tự")
                .maxUtf8Bytes("password", password, MAX_UTF8_BYTES,
                        "Mật khẩu quá dài (tối đa 72 byte, chữ có dấu tính 2–3 byte)")
                .matches("password", password, LETTER_AND_DIGIT, "Mật khẩu phải có cả chữ và số")
                .required("fullName", fullName, "Họ tên không được để trống")
                .maxLength("fullName", fullName, 100, "Họ tên tối đa 100 ký tự")
                .throwIfAny();
    }

    @Override
    public String toString() {
        return "RegisterCommand[phoneNumber=" + phoneNumber + ", password=***, fullName=" + fullName + "]";
    }
}
