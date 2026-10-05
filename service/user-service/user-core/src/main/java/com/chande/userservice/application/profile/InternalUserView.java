package com.chande.userservice.application.profile;

import com.chande.userservice.domain.user.User;
import com.chande.userservice.domain.user.UserStatus;

import java.util.UUID;

public record InternalUserView(UUID id, String fullName, String phoneNumber, UserStatus status) {

    static InternalUserView from(User user) {
        return new InternalUserView(user.id(), user.fullName(), user.phone().value(), user.status());
    }
}
