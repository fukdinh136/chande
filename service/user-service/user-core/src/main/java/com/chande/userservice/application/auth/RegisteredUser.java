package com.chande.userservice.application.auth;

import java.time.Instant;
import java.util.UUID;

public record RegisteredUser(UUID id, String phoneNumber, String fullName, Instant createdAt) {
}
