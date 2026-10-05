package com.chande.userservice.bootstrap;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Toàn bộ cấu hình, đọc từ biến môi trường lúc khởi động (mục 9). Thiếu hoặc sai giá trị thì
 * {@link #fromEnv(Map)} ném lỗi liệt kê <b>mọi</b> vấn đề, và service dừng ngay.
 */
public record AppConfig(int port, Db db, Jwt jwt, String internalApiKey, int bcryptCost, int maxBodyBytes,
                        Duration shutdownGrace) {

    public record Db(String url, String username, String password, int poolSize) {

        @Override
        public String toString() {
            return "Db[url=" + url + ", username=" + username + ", password=***, poolSize=" + poolSize + "]";
        }
    }

    /**
     * @param audience giá trị claim {@code aud}; rỗng thì không ghi claim này (mục 14.1, chưa chốt)
     */
    public record Jwt(String issuer, Path privateKeyFile, String keyId, Path previousPublicKeysDir,
                      Duration accessTokenTtl, Duration refreshTokenTtl, Duration clockSkew, List<String> audience) {
    }

    public static AppConfig fromEnv(Map<String, String> env) {
        Reader r = new Reader(env);
        int port = r.intValue("PORT", 3011, 1, 65535);
        Db db = new Db(
                r.string("DB_URL", "jdbc:postgresql://localhost:5432/user_service_db"),
                r.required("DB_USERNAME"),
                r.requiredAllowEmpty("DB_PASSWORD"),
                r.intValue("DB_POOL_SIZE", 10, 1, 500));
        Jwt jwt = new Jwt(
                r.required("JWT_ISSUER"),
                r.readableFile("JWT_PRIVATE_KEY_FILE"),
                r.required("JWT_KEY_ID"),
                r.optionalDirectory("JWT_PREVIOUS_PUBLIC_KEYS_DIR"),
                r.duration("ACCESS_TOKEN_TTL", Duration.ofMinutes(15), false),
                r.duration("REFRESH_TOKEN_TTL", Duration.ofDays(30), false),
                r.duration("JWT_CLOCK_SKEW", Duration.ofSeconds(60), true),
                r.list("JWT_AUDIENCE"));
        String internalApiKey = r.required("INTERNAL_API_KEY");
        if (internalApiKey != null && internalApiKey.length() < 16) {
            r.error("INTERNAL_API_KEY must be at least 16 characters");
        }
        int bcryptCost = r.intValue("BCRYPT_COST", 10, 4, 31);
        int maxBodyBytes = r.intValue("MAX_BODY_BYTES", 65536, 1, 16 * 1024 * 1024);
        Duration shutdownGrace = r.duration("SHUTDOWN_GRACE", Duration.ofSeconds(20), true);
        r.throwIfErrors();
        return new AppConfig(port, db, jwt, internalApiKey, bcryptCost, maxBodyBytes, shutdownGrace);
    }

    @Override
    public String toString() {
        return "AppConfig[port=" + port + ", db=" + db + ", jwt=" + jwt + ", internalApiKey=***, bcryptCost="
                + bcryptCost + ", maxBodyBytes=" + maxBodyBytes + ", shutdownGrace=" + shutdownGrace + "]";
    }

    /** Đọc từng biến, gom lỗi thay vì dừng ở lỗi đầu tiên. */
    private static final class Reader {

        private static final Pattern SIMPLE_DURATION = Pattern.compile("^(\\d+)(ms|s|m|h|d)$");

        private final Map<String, String> env;
        private final List<String> errors = new ArrayList<>();

        Reader(Map<String, String> env) {
            this.env = env;
        }

        void error(String message) {
            errors.add(message);
        }

        void throwIfErrors() {
            if (!errors.isEmpty()) {
                throw new IllegalStateException("Invalid configuration:\n  - " + String.join("\n  - ", errors));
            }
        }

        private String raw(String name) {
            String value = env.get(name);
            return value == null || value.isBlank() ? null : value.trim();
        }

        String string(String name, String defaultValue) {
            String value = raw(name);
            return value == null ? defaultValue : value;
        }

        String required(String name) {
            String value = raw(name);
            if (value == null) {
                error(name + " is required");
            }
            return value;
        }

        /** Bắt buộc phải khai báo, nhưng được để rỗng (VD: mật khẩu DB khi dùng trust auth). */
        String requiredAllowEmpty(String name) {
            String value = env.get(name);
            if (value == null) {
                error(name + " is required (may be empty)");
            }
            return value;
        }

        int intValue(String name, int defaultValue, int min, int max) {
            return parse(name, defaultValue, Integer::parseInt, value -> value >= min && value <= max,
                    "an integer between " + min + " and " + max);
        }

        Duration duration(String name, Duration defaultValue, boolean allowZero) {
            return parse(name, defaultValue, Reader::parseDuration,
                    value -> !value.isNegative() && (allowZero || !value.isZero()),
                    allowZero ? "a non-negative duration (e.g. 60s, 15m, 30d)" : "a positive duration (e.g. 15m, 30d)");
        }

        List<String> list(String name) {
            String value = raw(name);
            return value == null ? List.of()
                    : Arrays.stream(value.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
        }

        Path readableFile(String name) {
            String value = required(name);
            if (value == null) {
                return null;
            }
            Path path = Path.of(value);
            if (!Files.isRegularFile(path) || !Files.isReadable(path)) {
                error(name + " must point to a readable file: " + value);
            }
            return path;
        }

        Path optionalDirectory(String name) {
            String value = raw(name);
            if (value == null) {
                return null;
            }
            Path path = Path.of(value);
            if (!Files.isDirectory(path)) {
                error(name + " must point to a directory: " + value);
            }
            return path;
        }

        private <T> T parse(String name, T defaultValue, Function<String, T> parser,
                            java.util.function.Predicate<T> valid, String expected) {
            String value = raw(name);
            if (value == null) {
                return defaultValue;
            }
            try {
                T parsed = parser.apply(value);
                if (valid.test(parsed)) {
                    return parsed;
                }
            } catch (NumberFormatException | DateTimeParseException e) {
                // rơi xuống báo lỗi chung
            }
            error(name + " must be " + expected + ", got '" + value + "'");
            return defaultValue;
        }

        /** "15m", "30d", "60s", "500ms", "2h" hoặc ISO-8601 ("PT15M"). */
        static Duration parseDuration(String value) {
            Matcher m = SIMPLE_DURATION.matcher(value);
            if (!m.matches()) {
                return Duration.parse(value);
            }
            long amount = Long.parseLong(m.group(1));
            return switch (m.group(2)) {
                case "ms" -> Duration.ofMillis(amount);
                case "s" -> Duration.ofSeconds(amount);
                case "m" -> Duration.ofMinutes(amount);
                case "h" -> Duration.ofHours(amount);
                default -> Duration.ofDays(amount);
            };
        }
    }
}
