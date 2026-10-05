package com.chande.userservice.adapter.http.json;

import com.chande.userservice.application.auth.ChangePasswordCommand;

public record ChangePasswordBody(String oldPassword, String newPassword) {

    public ChangePasswordCommand toCommand() {
        return new ChangePasswordCommand(oldPassword, newPassword);
    }
}
