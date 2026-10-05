package com.chande.userservice.adapter.http.json;

import com.chande.userservice.application.auth.RegisterCommand;

public record RegisterBody(String phoneNumber, String password, String fullName) {

    public RegisterCommand toCommand() {
        return new RegisterCommand(phoneNumber, password, fullName);
    }
}
