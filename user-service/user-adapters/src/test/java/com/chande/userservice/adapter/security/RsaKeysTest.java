package com.chande.userservice.adapter.security;

import com.chande.userservice.adapter.support.TestKeys;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.math.BigInteger;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
import java.util.Base64;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RsaKeysTest {

    @TempDir
    Path dir;

    private static String pem(String type, byte[] der) {
        return "-----BEGIN " + type + "-----\n"
                + Base64.getMimeEncoder(64, "\n".getBytes()).encodeToString(der)
                + "\n-----END " + type + "-----\n";
    }

    @Test
    void loadsPkcs8PrivateKeyAndPreviousPublicKeys() throws IOException {
        Path privateKey = Files.writeString(dir.resolve("current.pem"),
                pem("PRIVATE KEY", TestKeys.CURRENT.getPrivate().getEncoded()));
        Path previous = Files.createDirectory(dir.resolve("previous"));
        Files.writeString(previous.resolve("user-2026-09.pem"), pem("PUBLIC KEY", TestKeys.PREVIOUS.getPublic().getEncoded()));
        Files.writeString(previous.resolve("README.txt"), "ignored");

        RsaKeys keys = RsaKeys.load(privateKey, "user-2026-10", previous);

        assertThat(keys.current().kid()).isEqualTo("user-2026-10");
        assertThat(keys.current().publicKey()).isEqualTo(TestKeys.CURRENT.getPublic());
        assertThat(keys.all()).containsOnlyKeys("user-2026-10", "user-2026-09");
        assertThat(keys.all().get("user-2026-09")).isEqualTo(TestKeys.PREVIOUS.getPublic());
        assertThat(keys.jwks().keys()).extracting(JwksDocument.Jwk::kid).containsExactly("user-2026-10", "user-2026-09");
    }

    @Test
    void jwksContainsOnlyPublicParametersEncodedUnsigned() {
        RsaKeys keys = RsaKeys.of("k1", TestKeys.privateKey(TestKeys.CURRENT), Map.of());
        JwksDocument.Jwk jwk = keys.jwks().keys().getFirst();

        assertThat(jwk.kty()).isEqualTo("RSA");
        assertThat(jwk.use()).isEqualTo("sig");
        assertThat(jwk.alg()).isEqualTo("RS256");
        assertThat(jwk.e()).isEqualTo("AQAB");
        byte[] n = Base64.getUrlDecoder().decode(jwk.n());
        assertThat(n).hasSize(256); // 2048 bit, không có byte 0x00 dấu ở đầu
        assertThat(new BigInteger(1, n)).isEqualTo(TestKeys.publicKey(TestKeys.CURRENT).getModulus());
        assertThat(jwk.n()).doesNotContain("=");
    }

    @Test
    void unsignedEncodingStripsSignByte() {
        BigInteger highBitSet = new BigInteger(1, new byte[]{(byte) 0x80, 0x01});
        assertThat(highBitSet.toByteArray()).hasSize(3);
        assertThat(Base64.getUrlDecoder().decode(JwksDocument.unsignedBase64Url(highBitSet))).containsExactly(0x80, 0x01);
    }

    @Test
    void rejectsPkcs1WithHint() throws IOException {
        Path file = Files.writeString(dir.resolve("rsa.pem"), "-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----\n");
        assertThatThrownBy(() -> RsaKeys.load(file, "k", null)).hasMessageContaining("pkcs8");
    }

    @Test
    void rejectsWeakKeys() {
        KeyPair weak = TestKeys.generate(1024);
        assertThatThrownBy(() -> RsaKeys.of("k", TestKeys.privateKey(weak), Map.of())).hasMessageContaining("2048");
        assertThatThrownBy(() -> RsaKeys.of("k", TestKeys.privateKey(TestKeys.CURRENT),
                Map.of("old", TestKeys.publicKey(weak)))).hasMessageContaining("2048");
    }

    @Test
    void rejectsDuplicateKid() {
        assertThatThrownBy(() -> RsaKeys.of("k", TestKeys.privateKey(TestKeys.CURRENT),
                Map.of("k", TestKeys.publicKey(TestKeys.PREVIOUS)))).hasMessageContaining("Duplicate");
    }
}
