package com.chande.userservice.adapter.http.json;

import com.chande.userservice.application.profile.UpdateProfileCommand;

public record UpdateProfileBody(String fullName, String avatarUrl) {

    public UpdateProfileCommand toCommand() {
        return new UpdateProfileCommand(fullName, avatarUrl);
    }
}
