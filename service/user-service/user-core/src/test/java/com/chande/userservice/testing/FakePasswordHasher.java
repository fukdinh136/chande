package com.chande.userservice.testing;

import com.chande.userservice.application.port.PasswordHasher;

import java.util.ArrayList;
import java.util.List;

/** Băm giả "hashed:&lt;raw&gt;", ghi lại mọi lời gọi. */
public final class FakePasswordHasher implements PasswordHasher {

    private final List<String> hashed = new ArrayList<>();
    private final List<String> matchedAgainst = new ArrayList<>();
    private boolean busy;

    public static String hashOf(String raw) {
        return "hashed:" + raw;
    }

    @Override
    public synchronized String hash(String raw) {
        if (busy) {
            throw new BusyException();
        }
        hashed.add(raw);
        return hashOf(raw);
    }

    @Override
    public synchronized boolean matches(String raw, String hash) {
        if (busy) {
            throw new BusyException();
        }
        matchedAgainst.add(hash);
        return hashOf(raw).equals(hash);
    }

    public synchronized List<String> hashedPasswords() {
        return List.copyOf(hashed);
    }

    /** Các hash đã được đem ra so. */
    public synchronized List<String> matchedHashes() {
        return List.copyOf(matchedAgainst);
    }

    /** Giả lập BCrypt quá tải: mọi lần băm ném {@link BusyException}. */
    public synchronized void busy(boolean value) {
        busy = value;
    }

    public synchronized void reset() {
        busy = false;
        hashed.clear();
        matchedAgainst.clear();
    }
}
