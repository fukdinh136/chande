package com.chande.userservice.adapter.support;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.NoSuchAlgorithmException;
import java.security.interfaces.RSAPrivateCrtKey;
import java.security.interfaces.RSAPublicKey;

/** Cặp khoá RSA dùng chung trong test (sinh khoá RSA chậm nên chỉ sinh một lần). */
public final class TestKeys {

    public static final KeyPair CURRENT = generate(2048);
    public static final KeyPair PREVIOUS = generate(2048);

    private TestKeys() {
    }

    public static KeyPair generate(int bits) {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(bits);
            return generator.generateKeyPair();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    public static RSAPrivateCrtKey privateKey(KeyPair pair) {
        return (RSAPrivateCrtKey) pair.getPrivate();
    }

    public static RSAPublicKey publicKey(KeyPair pair) {
        return (RSAPublicKey) pair.getPublic();
    }
}
