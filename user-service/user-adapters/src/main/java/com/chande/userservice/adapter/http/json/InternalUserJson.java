package com.chande.userservice.adapter.http.json;

import com.chande.userservice.application.profile.InternalUserView;

import java.util.UUID;

public record InternalUserJson(UUID id, String fullName, String phoneNumber, String status) {

    public static InternalUserJson from(InternalUserView view) {
        return new InternalUserJson(view.id(), view.fullName(), view.phoneNumber(), view.status().name());
    }
}
