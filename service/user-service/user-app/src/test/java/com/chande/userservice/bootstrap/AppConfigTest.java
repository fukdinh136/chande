package com.chande.userservice.bootstrap;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AppConfigTest {

    @TempDir
    Path dir;

    private Map<String, String> minimal() throws IOException {
        Path key = Files.writeString(dir.resolve("key.pem"), "dummy");
        Map<String, String> env = new HashMap<>();
        env.put("DB_USERNAME", "postgres");
        env.put("DB_PASSWORD", "");
        env.put("JWT_ISSUER", "https://identity.example.invalid/rider");
        env.put("JWT_PRIVATE_KEY_FILE", key.toString());
        env.put("JWT_KEY_ID", "user-2026-10");
        env.put("INTERNAL_API_KEY", "0123456789abcdef");
        return env;
    }

    @Test
    void appliesDefaults() throws IOException {
        AppConfig cfg = AppConfig.fromEnv(minimal());

        assertThat(cfg.port()).isEqualTo(3011);
        assertThat(cfg.db()).isEqualTo(new AppConfig.Db("jdbc:postgresql://localhost:5432/user_service_db", "postgres", "", 10));
        assertThat(cfg.jwt().accessTokenTtl()).isEqualTo(Duration.ofMinutes(15));
        assertThat(cfg.jwt().refreshTokenTtl()).isEqualTo(Duration.ofDays(30));
        assertThat(cfg.jwt().clockSkew()).isEqualTo(Duration.ofSeconds(60));
        assertThat(cfg.jwt().previousPublicKeysDir()).isNull();
        assertThat(cfg.jwt().audience()).isEmpty();
        assertThat(cfg.bcryptCost()).isEqualTo(10);
        assertThat(cfg.maxBodyBytes()).isEqualTo(65536);
        assertThat(cfg.shutdownGrace()).isEqualTo(Duration.ofSeconds(20));
    }

    @Test
    void readsOverrides() throws IOException {
        Map<String, String> env = minimal();
        env.put("PORT", "8081");
        env.put("ACCESS_TOKEN_TTL", "PT10M");
        env.put("REFRESH_TOKEN_TTL", "7d");
        env.put("JWT_CLOCK_SKEW", "0s");
        env.put("JWT_AUDIENCE", "trip-service, , driver-service");
        env.put("JWT_PREVIOUS_PUBLIC_KEYS_DIR", dir.toString());

        AppConfig cfg = AppConfig.fromEnv(env);

        assertThat(cfg.port()).isEqualTo(8081);
        assertThat(cfg.jwt().accessTokenTtl()).isEqualTo(Duration.ofMinutes(10));
        assertThat(cfg.jwt().refreshTokenTtl()).isEqualTo(Duration.ofDays(7));
        assertThat(cfg.jwt().clockSkew()).isZero();
        assertThat(cfg.jwt().audience()).isEqualTo(List.of("trip-service", "driver-service"));
        assertThat(cfg.jwt().previousPublicKeysDir()).isEqualTo(dir);
    }

    @Test
    void reportsEveryProblemAtOnce() {
        Map<String, String> env = new HashMap<>();
        env.put("PORT", "abc");
        env.put("ACCESS_TOKEN_TTL", "0m");
        env.put("BCRYPT_COST", "3");
        env.put("INTERNAL_API_KEY", "short");
        env.put("JWT_PRIVATE_KEY_FILE", dir.resolve("missing.pem").toString());

        assertThatThrownBy(() -> AppConfig.fromEnv(env))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("PORT")
                .hasMessageContaining("DB_USERNAME is required")
                .hasMessageContaining("DB_PASSWORD is required")
                .hasMessageContaining("JWT_ISSUER is required")
                .hasMessageContaining("JWT_PRIVATE_KEY_FILE must point to a readable file")
                .hasMessageContaining("JWT_KEY_ID is required")
                .hasMessageContaining("ACCESS_TOKEN_TTL must be a positive duration")
                .hasMessageContaining("BCRYPT_COST")
                .hasMessageContaining("INTERNAL_API_KEY must be at least 16 characters");
    }

    @Test
    void toStringHidesSecrets() throws IOException {
        Map<String, String> env = minimal();
        env.put("DB_PASSWORD", "db-secret");
        String text = AppConfig.fromEnv(env).toString();
        assertThat(text).doesNotContain("db-secret").doesNotContain("0123456789abcdef");
    }
}
