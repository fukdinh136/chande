package com.chande.userservice.adapter.security;

import com.chande.userservice.application.port.IdGenerator;

import java.util.UUID;

/** UUID v4 ngẫu nhiên. */
public final class UuidGenerator implements IdGenerator {

    @Override
    public UUID newId() {
        return UUID.randomUUID();
    }
}
