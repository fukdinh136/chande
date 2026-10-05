package com.chande.userservice.testing;

import com.chande.userservice.application.port.AccessTokenIssuer;

import java.time.Instant;
import java.util.UUID;

public final class FakeAccessTokenIssuer implements AccessTokenIssuer {

    public static final long TTL_SECONDS = 900;

    @Override
    public AccessToken issue(UUID userId, Instant now) {
        return new AccessToken("access:" + userId + ":" + now.getEpochSecond(), TTL_SECONDS);
    }
}
