package com.chande.user_service.user.dto;

import com.chande.user_service.user.User;

import java.time.OffsetDateTime;
import java.util.UUID;

public record UserProfileResponse(
        UUID id,
        String phoneNumber,
        String fullName,
        String avatarUrl,
        OffsetDateTime createdAt
) {
    public static UserProfileResponse from(User user) {
        return new UserProfileResponse(
                user.getId(),
                user.getPhoneNumber(),
                user.getFullName(),
                user.getAvatarUrl(),
                user.getCreatedAt()
        );
    }
}