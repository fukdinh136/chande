package com.chande.userservice.application.auth;

import com.chande.userservice.domain.common.FieldErrors;

import static com.chande.userservice.domain.user.PasswordPolicy.LETTER_AND_DIGIT;
import static com.chande.userservice.domain.user.PasswordPolicy.MAX_LENGTH;
import static com.chande.userservice.domain.user.PasswordPolicy.MAX_UTF8_BYTES;
import static com.chande.userservice.domain.user.PasswordPolicy.MIN_LENGTH;

/** P3. */
public record ChangePasswordCommand(String oldPassword, String newPassword) {

    public ChangePasswordCommand {
        new FieldErrors()
                .required("oldPassword", oldPassword, "Vui lòng nhập mật khẩu hiện tại")
                .maxLength("oldPassword", oldPassword, 72, "Mật khẩu tối đa 72 ký tự")
                .required("newPassword", newPassword, "Vui lòng nhập mật khẩu mới")
                .length("newPassword", newPassword, MIN_LENGTH, MAX_LENGTH, "Mật khẩu mới phải từ 8 đến 72 ký tự")
                .maxUtf8Bytes("newPassword", newPassword, MAX_UTF8_BYTES,
                        "Mật khẩu mới quá dài (tối đa 72 byte, chữ có dấu tính 2–3 byte)")
                .matches("newPassword", newPassword, LETTER_AND_DIGIT, "Mật khẩu mới phải có cả chữ và số")
                .throwIfAny();
    }

    @Override
    public String toString() {
        return "ChangePasswordCommand[oldPassword=***, newPassword=***]";
    }
}
