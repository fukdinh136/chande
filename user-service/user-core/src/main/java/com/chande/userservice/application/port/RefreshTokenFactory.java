package com.chande.userservice.application.port;

public interface RefreshTokenFactory {

    /** {@code raw} trả cho client; {@code hash} lưu vào DB. */
    record NewRefreshToken(String raw, String hash) {
    }

    NewRefreshToken generate();

    String hash(String raw);
}
