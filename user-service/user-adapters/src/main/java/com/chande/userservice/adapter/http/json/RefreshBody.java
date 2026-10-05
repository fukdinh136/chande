package com.chande.userservice.adapter.http.json;

import com.chande.userservice.application.auth.RefreshCommand;

public record RefreshBody(String refreshToken) {

    public RefreshCommand toCommand() {
        return new RefreshCommand(refreshToken);
    }
}
