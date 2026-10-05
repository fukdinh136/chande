package com.chande.userservice.testing;

import com.chande.userservice.application.port.RefreshTokenFactory;

import java.util.concurrent.atomic.AtomicInteger;

/** Token gốc "rt-1", "rt-2"...; hash là "sha(&lt;raw&gt;)". */
public final class FakeRefreshTokenFactory implements RefreshTokenFactory {

    private final AtomicInteger counter = new AtomicInteger();

    @Override
    public NewRefreshToken generate() {
        String raw = "rt-" + counter.incrementAndGet();
        return new NewRefreshToken(raw, hash(raw));
    }

    @Override
    public String hash(String raw) {
        return "sha(" + raw + ")";
    }
}
