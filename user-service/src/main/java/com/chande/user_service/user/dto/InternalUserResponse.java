package com.chande.user_service.user.dto;

import com.chande.user_service.user.User;
import com.chande.user_service.user.UserStatus;

import java.util.UUID;

public record InternalUserResponse(
        UUID id,
        String fullName,
        String phoneNumber,
        UserStatus status
) {
    public static InternalUserResponse from(User user) {
        return new InternalUserResponse(
                user.getId(),
                user.getFullName(),
                user.getPhoneNumber(),
                user.getStatus()
        );
    }
}