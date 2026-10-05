package com.chande.userservice.application.profile;

import com.chande.userservice.domain.user.User;

import java.time.Instant;
import java.util.UUID;

public record UserView(UUID id, String phoneNumber, String fullName, String avatarUrl, Instant createdAt) {

    static UserView from(User user) {
        return new UserView(user.id(), user.phone().value(), user.fullName(), user.avatarUrl(), user.createdAt());
    }
}
