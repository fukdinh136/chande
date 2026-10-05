package com.chande.userservice.adapter.http.json;

import com.chande.userservice.application.auth.LoginCommand;

public record LoginBody(String phoneNumber, String password) {

    public LoginCommand toCommand() {
        return new LoginCommand(phoneNumber, password);
    }
}
