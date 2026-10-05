package com.chande.userservice.testing;

import com.chande.userservice.application.port.IdGenerator;

import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;

/** UUID dễ đọc: 00000000-0000-4000-8000-000000000001, ...002, ... */
public final class SequentialIdGenerator implements IdGenerator {

    private final AtomicLong next = new AtomicLong(1);

    @Override
    public UUID newId() {
        return new UUID(0x0000000000004000L, 0x8000000000000000L | next.getAndIncrement());
    }
}
