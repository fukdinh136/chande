package com.chande.userservice.application.port;

import java.time.Instant;
import java.util.UUID;

public interface AccessTokenIssuer {

    record AccessToken(String value, long expiresInSeconds) {
    }

    AccessToken issue(UUID userId, Instant now);
}
