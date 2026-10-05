package com.chande.userservice.testing;

import com.chande.userservice.application.port.PasswordHasher;

import java.util.ArrayList;
import java.util.List;

/** Băm giả "hashed:&lt;raw&gt;", ghi lại mọi lời gọi. */
public final class FakePasswordHasher implements PasswordHasher {

    private final List<String> hashed = new ArrayList<>();
    private final List<String> matchedAgainst = new ArrayList<>();

    public static String hashOf(String raw) {
        return "hashed:" + raw;
    }

    @Override
    public synchronized String hash(String raw) {
        hashed.add(raw);
        return hashOf(raw);
    }

    @Override
    public synchronized boolean matches(String raw, String hash) {
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

    public synchronized void reset() {
        hashed.clear();
        matchedAgainst.clear();
    }
}
