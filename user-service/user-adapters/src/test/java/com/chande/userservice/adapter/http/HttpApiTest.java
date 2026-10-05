package com.chande.userservice.adapter.http;

import com.chande.userservice.adapter.support.TestJwts;
import com.chande.userservice.adapter.support.TestKeys;
import com.chande.userservice.domain.user.User;
import com.chande.userservice.domain.user.UserStatus;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

import java.io.IOException;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;

import static com.chande.userservice.adapter.http.HttpFixture.json;
import static org.assertj.core.api.Assertions.assertThat;

class HttpApiTest {

    private HttpFixture app;

    @BeforeEach
    void start() throws IOException {
        app = new HttpFixture();
    }

    @AfterEach
    void stop() {
        app.close();
    }

    private User seedUser() {
        return app.world.seedUser("+84912345678", "matkhau123", UserStatus.ACTIVE);
    }

    private static void assertError(HttpResponse<String> response, int status, String code) {
        assertThat(response.statusCode()).isEqualTo(status);
        assertThat(response.headers().firstValue("Content-Type")).hasValue("application/json");
        assertThat(json(response.body()).get("code").asString()).isEqualTo(code);
    }

    private static Map<String, String> fieldErrors(HttpResponse<String> response) {
        JsonNode node = json(response.body()).get("fieldErrors");
        assertThat(node).as("fieldErrors").isNotNull();
        var result = new java.util.LinkedHashMap<String, String>();
        node.properties().forEach(e -> result.put(e.getKey(), e.getValue().asString()));
        return result;
    }

    @Nested
    class CommonConventions {

        @Test
        void securityHeadersOnEveryBusinessResponse() {
            var ok = app.call("POST", "/auth/register")
                    .json("{\"phoneNumber\":\"0912345678\",\"password\":\"matkhau123\",\"fullName\":\"A\"}").send();
            var error = app.call("GET", "/nope").send();

            for (var response : java.util.List.of(ok, error)) {
                assertThat(response.headers().firstValue("Cache-Control")).hasValue("no-cache, no-store, max-age=0, must-revalidate");
                assertThat(response.headers().firstValue("Pragma")).hasValue("no-cache");
                assertThat(response.headers().firstValue("Expires")).hasValue("0");
                assertThat(response.headers().firstValue("X-Content-Type-Options")).hasValue("nosniff");
                assertThat(response.headers().firstValue("X-Frame-Options")).hasValue("DENY");
                assertThat(response.headers().firstValue("Access-Control-Allow-Origin")).isEmpty();
                assertThat(response.headers().firstValue("X-Request-Id")).isEmpty();
            }
        }

        @Test
        void unknownPathIs404EvenWithoutToken() {
            assertError(app.call("GET", "/users/unknown").send(), 404, "ENDPOINT_NOT_FOUND");
            assertError(app.call("GET", "/").send(), 404, "ENDPOINT_NOT_FOUND");
            assertError(app.call("GET", "/api/v1/users/me").send(), 404, "ENDPOINT_NOT_FOUND");
        }

        @Test
        void trailingSlashIs404() {
            assertError(app.call("GET", "/users/me/").bearer(seedUser().id()).send(), 404, "ENDPOINT_NOT_FOUND");
        }

        @Test
        void routesNotInV2Are404() {
            for (String path : new String[]{"/auth/register/verify", "/auth/otp/resend", "/auth/password/forgot",
                    "/auth/password/reset"}) {
                assertError(app.call("POST", path).json("{}").send(), 404, "ENDPOINT_NOT_FOUND");
            }
        }

        @Test
        void wrongMethodIs405WithAllowHeader() {
            var response = app.call("GET", "/auth/login").send();
            assertError(response, 405, "METHOD_NOT_ALLOWED");
            assertThat(response.headers().firstValue("Allow")).hasValue("POST");
            assertThat(app.call("DELETE", "/users/me").send().headers().firstValue("Allow")).hasValue("GET, PATCH");
        }

        @Test
        void errorBodyIsJsonEvenWhenClientAcceptsSomethingElse() {
            var response = app.call("POST", "/auth/login").header("Accept", "application/xml")
                    .json("{\"phoneNumber\":\"0912345678\",\"password\":\"sai\"}").send();
            assertError(response, 401, "INVALID_CREDENTIALS");
            assertThat(json(response.body()).get("message").asString()).isEqualTo("Số điện thoại hoặc mật khẩu không đúng");
            assertThat(json(response.body()).has("fieldErrors")).isFalse();
        }

        @Test
        void unexpectedErrorIs500WithoutDetails() {
            app.databaseHealth = () -> {
                throw new IllegalStateException("secret connection string jdbc:postgresql://db/password=123");
            };
            var response = app.call("GET", "/health").send();
            assertError(response, 500, "INTERNAL_ERROR");
            assertThat(response.body()).doesNotContain("secret").doesNotContain("jdbc");
        }
    }

    @Nested
    class RequestBodyHandling {

        private static final String VALID_REGISTER =
                "{\"phoneNumber\":\"0912345678\",\"password\":\"matkhau123\",\"fullName\":\"A\"}";

        @Test
        void missingOrWrongContentTypeIs415() {
            assertError(app.call("POST", "/auth/register").rawBody(VALID_REGISTER).send(), 415, "UNSUPPORTED_MEDIA_TYPE");
            assertError(app.call("POST", "/auth/register").header("Content-Type", "text/plain").rawBody(VALID_REGISTER)
                    .send(), 415, "UNSUPPORTED_MEDIA_TYPE");
        }

        @Test
        void contentTypeParametersAreAllowed() {
            var response = app.call("POST", "/auth/register").header("Content-Type", "Application/JSON; charset=utf-8")
                    .rawBody(VALID_REGISTER).send();
            assertThat(response.statusCode()).isEqualTo(201);
        }

        @Test
        void emptyMalformedOrNullBodyIs400WithoutFieldErrors() {
            for (String body : new String[]{"", "   ", "{", "null", "[]", "\"x\"", "{} {}"}) {
                var response = app.call("POST", "/auth/register").json(body).send();
                assertError(response, 400, "VALIDATION_ERROR");
                assertThat(json(response.body()).has("fieldErrors")).as(body).isFalse();
            }
        }

        @Test
        void wrongJsonTypesAreRejectedNotCoerced() {
            String[] bodies = {
                    "{\"phoneNumber\":912345678,\"password\":\"matkhau123\",\"fullName\":\"A\"}",
                    "{\"phoneNumber\":\"0912345678\",\"password\":true,\"fullName\":\"A\"}",
                    "{\"phoneNumber\":\"0912345678\",\"password\":\"matkhau123\",\"fullName\":[\"A\"]}",
                    "{\"phoneNumber\":\"0912345678\",\"password\":\"matkhau123\",\"fullName\":{\"a\":1}}",
            };
            for (String body : bodies) {
                var response = app.call("POST", "/auth/register").json(body).send();
                assertError(response, 400, "VALIDATION_ERROR");
                assertThat(json(response.body()).has("fieldErrors")).as(body).isFalse();
            }
        }

        @Test
        void unknownFieldsAreIgnored() {
            var response = app.call("POST", "/auth/register")
                    .json("{\"phoneNumber\":\"0912345678\",\"password\":\"matkhau123\",\"fullName\":\"A\",\"role\":\"ADMIN\",\"x\":[1,{}]}")
                    .send();
            assertThat(response.statusCode()).isEqualTo(201);
        }

        @Test
        void bodyOverLimitIs413() {
            String big = "{\"phoneNumber\":\"" + "1".repeat(HttpFixture.MAX_BODY_BYTES) + "\"}";
            assertError(app.call("POST", "/auth/register").json(big).send(), 413, "PAYLOAD_TOO_LARGE");
        }
    }

    @Nested
    class Auth {

        @Test
        void registerReturns201WithNormalizedPhoneAndNoTokens() {
            var response = app.call("POST", "/auth/register")
                    .json("{\"phoneNumber\":\"091 234 5678\",\"password\":\"matkhau123\",\"fullName\":\"  Nguyễn Văn A  \"}")
                    .send();

            assertThat(response.statusCode()).isEqualTo(201);
            assertThat(response.headers().firstValue("Location")).isEmpty();
            JsonNode body = json(response.body());
            assertThat(body.propertyNames()).containsExactly("id", "phoneNumber", "fullName", "createdAt");
            assertThat(UUID.fromString(body.get("id").asString())).isNotNull();
            assertThat(body.get("phoneNumber").asString()).isEqualTo("+84912345678");
            assertThat(body.get("fullName").asString()).isEqualTo("Nguyễn Văn A");
            assertThat(body.get("createdAt").asString()).isEqualTo("2026-10-06T01:02:03.123456Z");
        }

        @Test
        void registerValidationErrors() {
            var response = app.call("POST", "/auth/register").json("{\"password\":\"abc\"}").send();

            assertError(response, 400, "VALIDATION_ERROR");
            assertThat(json(response.body()).get("message").asString()).isEqualTo("Dữ liệu không hợp lệ");
            assertThat(fieldErrors(response)).containsExactly(
                    Map.entry("phoneNumber", "Số điện thoại không được để trống"),
                    Map.entry("password", "Mật khẩu phải từ 8 đến 72 ký tự"),
                    Map.entry("fullName", "Họ tên không được để trống"));
        }

        @Test
        void registerDuplicateAndInvalidPhone() {
            seedUser();
            assertError(app.call("POST", "/auth/register")
                    .json("{\"phoneNumber\":\"84912345678\",\"password\":\"matkhau123\",\"fullName\":\"A\"}").send(),
                    409, "PHONE_ALREADY_EXISTS");
            assertError(app.call("POST", "/auth/register")
                    .json("{\"phoneNumber\":\"0123456789\",\"password\":\"matkhau123\",\"fullName\":\"A\"}").send(),
                    400, "INVALID_PHONE_NUMBER");
        }

        @Test
        void loginReturnsTokenPair() {
            User user = seedUser();
            var response = app.call("POST", "/auth/login")
                    .json("{\"phoneNumber\":\"0912345678\",\"password\":\"matkhau123\"}").send();

            assertThat(response.statusCode()).isEqualTo(200);
            JsonNode body = json(response.body());
            assertThat(body.propertyNames()).containsExactly("accessToken", "refreshToken", "tokenType", "expiresIn");
            assertThat(body.get("tokenType").asString()).isEqualTo("Bearer");
            assertThat(body.get("expiresIn").asLong()).isEqualTo(900);
            String accessToken = body.get("accessToken").asString();
            assertThat(TestJwts.decodePart(accessToken, 1)).containsEntry("sub", user.id().toString());
            // access token vừa cấp mở được route RIDER
            assertThat(app.call("GET", "/users/me").header("Authorization", "Bearer " + accessToken).send().statusCode())
                    .isEqualTo(200);
        }

        @Test
        void loginFailures() {
            seedUser();
            app.world.seedUser("+84987654321", "matkhau123", UserStatus.BLOCKED);
            assertError(app.call("POST", "/auth/login").json("{\"phoneNumber\":\"0912345678\",\"password\":\"sai\"}").send(),
                    401, "INVALID_CREDENTIALS");
            assertError(app.call("POST", "/auth/login").json("{\"phoneNumber\":\"0911111111\",\"password\":\"matkhau123\"}").send(),
                    401, "INVALID_CREDENTIALS");
            assertError(app.call("POST", "/auth/login").json("{\"phoneNumber\":\"0987654321\",\"password\":\"matkhau123\"}").send(),
                    403, "USER_BLOCKED");
        }

        @Test
        void publicRoutesIgnoreAuthorizationHeader() {
            seedUser();
            var response = app.call("POST", "/auth/login").header("Authorization", "Bearer expired.or.garbage")
                    .json("{\"phoneNumber\":\"0912345678\",\"password\":\"matkhau123\"}").send();
            assertThat(response.statusCode()).isEqualTo(200);
        }

        @Test
        void refreshRotateThenReuseDetection() {
            seedUser();
            String first = json(app.call("POST", "/auth/login")
                    .json("{\"phoneNumber\":\"0912345678\",\"password\":\"matkhau123\"}").send().body())
                    .get("refreshToken").asString();

            var refreshed = app.call("POST", "/auth/refresh").header("Authorization", "Bearer old.expired.token")
                    .json("{\"refreshToken\":\"" + first + "\"}").send();
            assertThat(refreshed.statusCode()).isEqualTo(200);
            String second = json(refreshed.body()).get("refreshToken").asString();

            assertError(app.call("POST", "/auth/refresh").json("{\"refreshToken\":\"" + first + "\"}").send(),
                    401, "INVALID_REFRESH_TOKEN");
            assertError(app.call("POST", "/auth/refresh").json("{\"refreshToken\":\"" + second + "\"}").send(),
                    401, "INVALID_REFRESH_TOKEN");
        }

        @Test
        void logoutNeedsNoJwtAndAlwaysReturns204() {
            seedUser();
            String refresh = json(app.call("POST", "/auth/login")
                    .json("{\"phoneNumber\":\"0912345678\",\"password\":\"matkhau123\"}").send().body())
                    .get("refreshToken").asString();

            var response = app.call("POST", "/auth/logout").json("{\"refreshToken\":\"" + refresh + "\"}").send();
            assertThat(response.statusCode()).isEqualTo(204);
            assertThat(response.body()).isEmpty();
            assertThat(response.headers().firstValue("Content-Type")).isEmpty();
            assertThat(app.call("POST", "/auth/logout").json("{\"refreshToken\":\"unknown\"}").send().statusCode())
                    .isEqualTo(204);
            assertThat(app.world.refreshTokens.count()).isZero();
        }

        @Test
        void logoutAllIgnoresBodyAndContentType() {
            User user = seedUser();
            app.call("POST", "/auth/login").json("{\"phoneNumber\":\"0912345678\",\"password\":\"matkhau123\"}").send();

            var response = app.call("POST", "/auth/logout-all").bearer(user.id())
                    .header("Content-Type", "text/plain").rawBody("whatever").send();

            assertThat(response.statusCode()).isEqualTo(204);
            assertThat(app.world.refreshTokens.forUser(user.id())).isEmpty();
            assertError(app.call("POST", "/auth/logout-all").send(), 401, "AUTHENTICATION_REQUIRED");
        }
    }

    @Nested
    class RiderAuthentication {

        @Test
        void missingOrMalformedAuthorizationIs401() {
            assertError(app.call("GET", "/users/me").send(), 401, "AUTHENTICATION_REQUIRED");
            assertError(app.call("GET", "/users/me").header("Authorization", "Basic abc").send(), 401, "AUTHENTICATION_REQUIRED");
            assertError(app.call("GET", "/users/me").header("Authorization", "Bearer").send(), 401, "AUTHENTICATION_REQUIRED");
            assertError(app.call("GET", "/users/me").header("Authorization", "Bearer not-a-jwt").send(), 401, "AUTHENTICATION_REQUIRED");
            assertThat(json(app.call("GET", "/users/me").send().body()).get("message").asString())
                    .isEqualTo("Bạn cần đăng nhập hoặc token không hợp lệ");
        }

        @Test
        void bearerSchemeIsCaseInsensitive() {
            User user = seedUser();
            var response = app.call("GET", "/users/me").header("Authorization", "bEaReR " + app.accessToken(user.id())).send();
            assertThat(response.statusCode()).isEqualTo(200);
        }

        @Test
        void expiredTokenIs401() {
            User user = seedUser();
            String token = app.accessToken(user.id());
            app.world.clock.advance(Duration.ofMinutes(15).plusSeconds(61));
            assertError(app.call("GET", "/users/me").header("Authorization", "Bearer " + token).send(), 401,
                    "AUTHENTICATION_REQUIRED");
        }

        @Test
        void validTokenWithOtherRoleIs403() {
            User user = seedUser();
            long now = app.world.clock.instant().getEpochSecond();
            String driverToken = TestJwts.rs256(TestKeys.CURRENT.getPrivate(),
                    Map.of("alg", "RS256", "kid", "test-kid"),
                    Map.of("iss", HttpFixture.ISSUER, "sub", user.id().toString(), "role", "DRIVER", "exp", now + 600));
            assertError(app.call("GET", "/users/me").header("Authorization", "Bearer " + driverToken).send(), 403,
                    "ACCESS_DENIED");
        }

        @Test
        void internalKeyDoesNotOpenUserRoutes() {
            seedUser();
            assertError(app.call("GET", "/users/me").internalKey().send(), 401, "AUTHENTICATION_REQUIRED");
        }
    }

    @Nested
    class Profile {

        @Test
        void getProfileWritesNullFields() {
            User user = seedUser();
            var response = app.call("GET", "/users/me").bearer(user.id()).send();

            assertThat(response.statusCode()).isEqualTo(200);
            JsonNode body = json(response.body());
            assertThat(body.propertyNames()).containsExactly("id", "phoneNumber", "fullName", "avatarUrl", "createdAt");
            assertThat(body.get("avatarUrl").isNull()).isTrue();
            assertThat(body.get("phoneNumber").asString()).isEqualTo("+84912345678");
        }

        @Test
        void unknownUserIs404() {
            assertError(app.call("GET", "/users/me").bearer(UUID.randomUUID()).send(), 404, "USER_NOT_FOUND");
        }

        @Test
        void patchUpdatesOnlyGivenFieldsAndIgnoresPhone() {
            User user = seedUser();
            var response = app.call("PATCH", "/users/me").bearer(user.id())
                    .json("{\"fullName\":\"  Nguyễn Văn B \",\"phoneNumber\":\"0999999999\"}").send();

            assertThat(response.statusCode()).isEqualTo(200);
            JsonNode body = json(response.body());
            assertThat(body.get("fullName").asString()).isEqualTo("Nguyễn Văn B");
            assertThat(body.get("phoneNumber").asString()).isEqualTo("+84912345678");

            assertThat(app.call("PATCH", "/users/me").bearer(user.id()).json("{}").send().statusCode()).isEqualTo(200);
            assertError(app.call("PATCH", "/users/me").bearer(user.id()).send(), 415, "UNSUPPORTED_MEDIA_TYPE");
            assertError(app.call("PATCH", "/users/me").bearer(user.id()).json("").send(), 400, "VALIDATION_ERROR");
        }

        @Test
        void patchValidation() {
            User user = seedUser();
            var response = app.call("PATCH", "/users/me").bearer(user.id()).json("{\"avatarUrl\":\"\"}").send();
            assertError(response, 400, "VALIDATION_ERROR");
            assertThat(fieldErrors(response))
                    .containsExactly(Map.entry("avatarUrl", "URL ảnh phải bắt đầu bằng http:// hoặc https://"));
        }

        @Test
        void changePasswordRevokesSessionsAndReturnsFlag() {
            User user = seedUser();
            String refresh = json(app.call("POST", "/auth/login")
                    .json("{\"phoneNumber\":\"0912345678\",\"password\":\"matkhau123\"}").send().body())
                    .get("refreshToken").asString();

            var response = app.call("POST", "/users/me/password").bearer(user.id())
                    .json("{\"oldPassword\":\"matkhau123\",\"newPassword\":\"matkhaumoi456\"}").send();

            assertThat(response.statusCode()).isEqualTo(200);
            assertThat(json(response.body()).toString()).isEqualTo("{\"passwordChanged\":true}");
            assertError(app.call("POST", "/auth/refresh").json("{\"refreshToken\":\"" + refresh + "\"}").send(),
                    401, "INVALID_REFRESH_TOKEN");
            assertThat(app.call("POST", "/auth/login")
                    .json("{\"phoneNumber\":\"0912345678\",\"password\":\"matkhaumoi456\"}").send().statusCode())
                    .isEqualTo(200);
        }

        @Test
        void changePasswordErrors() {
            User user = seedUser();
            assertError(app.call("POST", "/users/me/password").bearer(user.id())
                    .json("{\"oldPassword\":\"sai12345\",\"newPassword\":\"matkhaumoi456\"}").send(), 400, "WRONG_OLD_PASSWORD");
            assertError(app.call("POST", "/users/me/password").bearer(user.id())
                    .json("{\"oldPassword\":\"matkhau123\",\"newPassword\":\"matkhau123\"}").send(), 400, "NEW_PASSWORD_SAME_AS_OLD");
        }
    }

    @Nested
    class Addresses {

        private UUID userId;

        @BeforeEach
        void user() {
            userId = seedUser().id();
        }

        private HttpResponse<String> create(String body) {
            return app.call("POST", "/users/me/addresses").bearer(userId).json(body).send();
        }

        @Test
        void createReturns201WithPlainCoordinates() {
            var response = create("{\"label\":\" Nhà \",\"addressText\":\" Keangnam \",\"lat\":21.017,\"lng\":105,\"makeDefault\":false}");

            assertThat(response.statusCode()).isEqualTo(201);
            assertThat(response.headers().firstValue("Location")).isEmpty();
            JsonNode body = json(response.body());
            assertThat(body.propertyNames())
                    .containsExactly("id", "label", "addressText", "lat", "lng", "isDefault", "createdAt");
            assertThat(body.get("label").asString()).isEqualTo("Nhà");
            assertThat(body.get("isDefault").asBoolean()).isTrue();
            assertThat(response.body()).contains("\"lat\":21.01700000").contains("\"lng\":105.00000000");
        }

        @Test
        void zeroCoordinatesAreNotWrittenInScientificNotation() {
            var response = create("{\"addressText\":\"Null Island\",\"lat\":0,\"lng\":-0.0}");
            assertThat(response.body()).contains("\"lat\":0.00000000").contains("\"lng\":0.00000000")
                    .contains("\"label\":null");
        }

        @Test
        void coordinateTypeErrors() {
            for (String body : new String[]{
                    "{\"addressText\":\"x\",\"lat\":\"21.0\",\"lng\":105}",
                    "{\"addressText\":\"x\",\"lat\":21,\"lng\":105,\"makeDefault\":1}",
                    "{\"addressText\":\"x\",\"lat\":21,\"lng\":105,\"makeDefault\":\"true\"}",
                    "{\"addressText\":\"x\",\"lat\":true,\"lng\":105}"}) {
                var response = create(body);
                assertError(response, 400, "VALIDATION_ERROR");
                assertThat(json(response.body()).has("fieldErrors")).as(body).isFalse();
            }
        }

        @Test
        void validationErrors() {
            var response = create("{\"addressText\":\"\",\"lat\":91,\"lng\":null}");
            assertThat(fieldErrors(response)).containsExactly(
                    Map.entry("addressText", "Địa chỉ không được để trống"),
                    Map.entry("lat", "Vĩ độ phải từ -90 đến 90"),
                    Map.entry("lng", "Thiếu kinh độ"));
        }

        @Test
        void listIsDefaultFirstThenNewest() {
            create("{\"label\":\"A\",\"addressText\":\"a\",\"lat\":1,\"lng\":1}");
            app.world.clock.advance(Duration.ofSeconds(1));
            create("{\"label\":\"B\",\"addressText\":\"b\",\"lat\":1,\"lng\":1}");

            var response = app.call("GET", "/users/me/addresses").bearer(userId).send();

            assertThat(response.statusCode()).isEqualTo(200);
            JsonNode list = json(response.body());
            assertThat(list.isArray()).isTrue();
            assertThat(list.get(0).get("label").asString()).isEqualTo("A");
            assertThat(list.get(1).get("label").asString()).isEqualTo("B");
        }

        @Test
        void emptyListIsArray() {
            assertThat(app.call("GET", "/users/me/addresses").bearer(userId).send().body()).isEqualTo("[]");
        }

        @Test
        void updateSetDefaultAndDelete() {
            String a = json(create("{\"label\":\"A\",\"addressText\":\"a\",\"lat\":1,\"lng\":1}").body()).get("id").asString();
            app.world.clock.advance(Duration.ofSeconds(1));
            String b = json(create("{\"label\":\"B\",\"addressText\":\"b\",\"lat\":1,\"lng\":1}").body()).get("id").asString();

            var updated = app.call("PUT", "/users/me/addresses/" + b).bearer(userId)
                    .json("{\"addressText\":\"b2\",\"lat\":2,\"lng\":2}").send();
            assertThat(updated.statusCode()).isEqualTo(200);
            assertThat(json(updated.body()).get("label").isNull()).isTrue();
            assertThat(json(updated.body()).get("isDefault").asBoolean()).isFalse();

            var setDefault = app.call("PUT", "/users/me/addresses/" + b + "/default").bearer(userId).send();
            assertThat(setDefault.statusCode()).isEqualTo(200);
            assertThat(json(setDefault.body()).get("isDefault").asBoolean()).isTrue();

            var deleted = app.call("DELETE", "/users/me/addresses/" + b).bearer(userId).send();
            assertThat(deleted.statusCode()).isEqualTo(204);
            assertThat(deleted.body()).isEmpty();
            JsonNode remaining = json(app.call("GET", "/users/me/addresses").bearer(userId).send().body());
            assertThat(remaining.size()).isEqualTo(1);
            assertThat(remaining.get(0).get("id").asString()).isEqualTo(a);
            assertThat(remaining.get(0).get("isDefault").asBoolean()).isTrue();
        }

        @Test
        void invalidAddressIdIs400BeforeContentTypeCheck() {
            var response = app.call("PUT", "/users/me/addresses/not-a-uuid").bearer(userId).rawBody("x").send();
            assertError(response, 400, "VALIDATION_ERROR");
            assertThat(fieldErrors(response)).containsExactly(Map.entry("addressId", "Giá trị không hợp lệ"));
            // UUID dạng rút gọn mà UUID.fromString chấp nhận vẫn bị từ chối
            assertError(app.call("DELETE", "/users/me/addresses/1-1-1-1-1").bearer(userId).send(), 400, "VALIDATION_ERROR");
        }

        @Test
        void authenticationIsCheckedBeforePathParam() {
            assertError(app.call("DELETE", "/users/me/addresses/not-a-uuid").send(), 401, "AUTHENTICATION_REQUIRED");
        }

        @Test
        void otherUsersAddressIs404() {
            String a = json(create("{\"addressText\":\"a\",\"lat\":1,\"lng\":1}").body()).get("id").asString();
            UUID other = app.world.seedUser("+84987654321", "matkhau123", UserStatus.ACTIVE).id();

            assertError(app.call("PUT", "/users/me/addresses/" + a + "/default").bearer(other).send(), 404, "ADDRESS_NOT_FOUND");
            assertError(app.call("DELETE", "/users/me/addresses/" + UUID.randomUUID()).bearer(userId).send(), 404,
                    "ADDRESS_NOT_FOUND");
        }

        @Test
        void limitReached() {
            for (int i = 0; i < 10; i++) {
                create("{\"addressText\":\"a\",\"lat\":1,\"lng\":1}");
            }
            var response = create("{\"addressText\":\"a\",\"lat\":1,\"lng\":1}");
            assertError(response, 400, "ADDRESS_LIMIT_REACHED");
            assertThat(json(response.body()).get("message").asString()).isEqualTo("Bạn chỉ được lưu tối đa 10 địa chỉ");
        }
    }

    @Nested
    class Internal {

        @Test
        void returnsUserWithStatus() {
            User user = app.world.seedUser("+84912345678", "matkhau123", UserStatus.BLOCKED);
            var response = app.call("GET", "/internal/users/" + user.id()).internalKey().send();

            assertThat(response.statusCode()).isEqualTo(200);
            JsonNode body = json(response.body());
            assertThat(body.propertyNames()).containsExactly("id", "fullName", "phoneNumber", "status");
            assertThat(body.get("status").asString()).isEqualTo("BLOCKED");
        }

        @Test
        void requiresInternalKey() {
            User user = seedUser();
            assertError(app.call("GET", "/internal/users/" + user.id()).send(), 401, "AUTHENTICATION_REQUIRED");
            assertError(app.call("GET", "/internal/users/" + user.id()).header("X-Internal-Key", "wrong").send(), 401,
                    "AUTHENTICATION_REQUIRED");
            assertError(app.call("GET", "/internal/users/" + user.id()).bearer(user.id()).send(), 401,
                    "AUTHENTICATION_REQUIRED");
        }

        @Test
        void invalidOrUnknownUserId() {
            var response = app.call("GET", "/internal/users/abc").internalKey().send();
            assertError(response, 400, "VALIDATION_ERROR");
            assertThat(fieldErrors(response)).containsExactly(Map.entry("userId", "Giá trị không hợp lệ"));
            assertError(app.call("GET", "/internal/users/" + UUID.randomUUID()).internalKey().send(), 404, "USER_NOT_FOUND");
        }
    }

    @Nested
    class Infrastructure {

        @Test
        void jwksIsCacheableAndContainsPublicKeyOnly() {
            var response = app.call("GET", "/.well-known/jwks.json").send();

            assertThat(response.statusCode()).isEqualTo(200);
            assertThat(response.headers().firstValue("Cache-Control")).hasValue("public, max-age=60");
            assertThat(response.headers().firstValue("Pragma")).isEmpty();
            assertThat(response.headers().firstValue("Expires")).isEmpty();
            JsonNode key = json(response.body()).get("keys").get(0);
            assertThat(key.propertyNames()).containsExactly("kty", "use", "alg", "kid", "n", "e");
            assertThat(key.get("kid").asString()).isEqualTo("test-kid");
            assertThat(response.body()).doesNotContain("\"d\"");
        }

        @Test
        void health() {
            var up = app.call("GET", "/health").send();
            assertThat(up.statusCode()).isEqualTo(200);
            assertThat(up.body()).isEqualTo("{\"status\":\"UP\"}");

            app.databaseHealth = () -> false;
            var down = app.call("GET", "/health").send();
            assertThat(down.statusCode()).isEqualTo(503);
            assertThat(down.body()).isEqualTo("{\"status\":\"DOWN\"}");
        }
    }
}
