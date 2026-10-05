package com.chande.userservice.adapter.http.json;

import com.chande.userservice.application.auth.TokenPair;

public record TokenJson(String accessToken, String refreshToken, String tokenType, long expiresIn) {

    public static TokenJson from(TokenPair pair) {
        return new TokenJson(pair.accessToken(), pair.refreshToken(), "Bearer", pair.expiresInSeconds());
    }
}
