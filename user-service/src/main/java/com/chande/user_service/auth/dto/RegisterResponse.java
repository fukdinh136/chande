package com.chande.user_service.auth.dto;

import com.chande.user_service.user.User;

import java.time.OffsetDateTime;
import java.util.UUID;

public record RegisterResponse(UUID id, String phoneNumber, String fullName, OffsetDateTime createdAt) {
    public static RegisterResponse from(User user){
        return new  RegisterResponse(user.getId(),user.getPhoneNumber(),user.getFullName(),user.getCreatedAt());
    }
}
