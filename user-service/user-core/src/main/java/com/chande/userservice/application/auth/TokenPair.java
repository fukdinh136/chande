package com.chande.userservice.application.auth;

public record TokenPair(String accessToken, String refreshToken, long expiresInSeconds) {

    @Override
    public String toString() {
        return "TokenPair[accessToken=***, refreshToken=***, expiresInSeconds=" + expiresInSeconds + "]";
    }
}
