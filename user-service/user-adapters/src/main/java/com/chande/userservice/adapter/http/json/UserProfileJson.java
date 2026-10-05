package com.chande.userservice.adapter.http.json;

import com.chande.userservice.application.profile.UserView;

import java.util.UUID;

public record UserProfileJson(UUID id, String phoneNumber, String fullName, String avatarUrl, String createdAt) {

    public static UserProfileJson from(UserView view) {
        return new UserProfileJson(view.id(), view.phoneNumber(), view.fullName(), view.avatarUrl(),
                Timestamps.format(view.createdAt()));
    }
}
