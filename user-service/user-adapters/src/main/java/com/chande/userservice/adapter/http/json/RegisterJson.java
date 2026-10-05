package com.chande.userservice.adapter.http.json;

import com.chande.userservice.application.auth.RegisteredUser;

import java.util.UUID;

public record RegisterJson(UUID id, String phoneNumber, String fullName, String createdAt) {

    public static RegisterJson from(RegisteredUser user) {
        return new RegisterJson(user.id(), user.phoneNumber(), user.fullName(), Timestamps.format(user.createdAt()));
    }
}
