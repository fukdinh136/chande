package com.chande.api_gateway.routing;

import com.chande.api_gateway.realtime.TripEvent;
import com.chande.api_gateway.realtime.TripEventInbox;
import com.chande.api_gateway.support.StubService;
import com.chande.api_gateway.support.TestTokens;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.Semaphore;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class GatewayRoutingIntegrationTest {

    static final StubService USER_A = StubService.start("user-service-A");
    static final StubService USER_B = StubService.start("user-service-B");
    static final StubService DRIVER = StubService.start("driver-service");
    static final StubService TRIP = StubService.start("trip-service");
    static final StubService ROUTING = StubService.start("routing-service");
    static final StubService MATCHING = StubService.start("matching-service");
    static final String DEAD_TRIP_INSTANCE = StubService.deadUrl();
    static final TestTokens TOKENS = new TestTokens();
    static final int INTERNAL_PORT = StubService.freePort();
    static final String TRIP_SERVICE_TOKEN = "test-trip-service-token-0123456789abcdef";

    static final UUID RIDER_ID = UUID.randomUUID();
    static final UUID DRIVER_ID = UUID.randomUUID();
    static final JsonMapper JSON = JsonMapper.builder().build();

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("gateway.routing.services.user-service.instances", () -> USER_A.url() + "," + USER_B.url());
        registry.add("gateway.routing.services.driver-service.instances", DRIVER::url);
        // Instance đầu tiên của Trip không chạy: mọi request Trip đều kiểm tra luôn failover
        registry.add("gateway.routing.services.trip-service.instances", () -> DEAD_TRIP_INSTANCE + "," + TRIP.url());
        registry.add("gateway.routing.services.routing-service.instances", ROUTING::url);
        registry.add("gateway.routing.services.routing-service.max-concurrent-requests", () -> 2);
        registry.add("gateway.routing.services.routing-service.service-token", () -> "trusted-routing-server-token");
        registry.add("gateway.routing.services.matching-service.instances", MATCHING::url);
        // Cooldown rất ngắn để instance chết bị thử lại thường xuyên → luôn đi qua nhánh failover
        registry.add("gateway.routing.failover.unavailable-cooldown", () -> "1ms");
        registry.add("gateway.internal.port", () -> INTERNAL_PORT);
        registry.add("gateway.internal.callers.trip-service", () -> TRIP_SERVICE_TOKEN);
        registry.add("jwt.issuers[0].issuer", () -> TestTokens.RIDER_ISSUER);
        registry.add("jwt.issuers[0].jwk-set-uri", TOKENS::riderJwksUri);
        registry.add("jwt.issuers[0].roles", () -> "RIDER");
        registry.add("jwt.issuers[1].issuer", () -> TestTokens.DRIVER_ISSUER);
        registry.add("jwt.issuers[1].jwk-set-uri", TOKENS::driverJwksUri);
        registry.add("jwt.issuers[1].roles", () -> "DRIVER");
        registry.add("rate-limit.auth.max-attempts", () -> 10_000);
    }

    @AfterAll
    static void stopStubs() {
        List.of(USER_A, USER_B, DRIVER, TRIP, ROUTING, MATCHING).forEach(StubService::close);
        TOKENS.close();
    }

    @MockitoBean
    TripEventInbox inbox;

    @LocalServerPort
    int port;

    final HttpClient http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build();

    // ---------- Định tuyến ----------

    record Route(String method, String path, String token, String expectedService, String expectedPath) {
    }

    List<Route> documentedRoutes() {
        String rider = TOKENS.rider(RIDER_ID);
        String driver = TOKENS.driver(DRIVER_ID);
        String tripId = "20000000-0000-4000-8000-000000000001";
        return List.of(
                new Route("POST", "/api/v1/auth/login", null, "user-service", "/auth/login"),
                new Route("POST", "/api/v1/auth/register", null, "user-service", "/auth/register"),
                new Route("POST", "/api/v1/auth/logout-all", rider, "user-service", "/auth/logout-all"),
                new Route("GET", "/api/v1/users/me", rider, "user-service", "/users/me"),
                new Route("PATCH", "/api/v1/users/me", rider, "user-service", "/users/me"),
                new Route("POST", "/api/v1/driver-auth/otp/request", null, "driver-service", "/driver-auth/otp/request"),
                new Route("GET", "/api/v1/drivers/me/vehicles", driver, "driver-service", "/drivers/me/vehicles"),
                new Route("PUT", "/api/v1/drivers/me/availability", driver, "driver-service", "/drivers/me/availability"),
                new Route("POST", "/api/v1/trips/estimate", rider, "trip-service", "/trips/estimate"),
                new Route("GET", "/api/v1/trips/active", driver, "trip-service", "/trips/active"),
                new Route("GET", "/api/v1/trips/" + tripId, rider, "trip-service", "/trips/" + tripId),
                new Route("PATCH", "/api/v1/trips/" + tripId + "/status", driver, "trip-service", "/trips/" + tripId + "/status"),
                new Route("POST", "/api/v1/trips/" + tripId + "/cancel", rider, "trip-service", "/trips/" + tripId + "/cancel"),
                new Route("GET", "/api/v1/matching/offers/active", driver, "matching-service", "/matching/offers/active"),
                new Route("POST", "/api/v1/routes", rider, "routing-service", "/routes"));
    }

    @Test
    void routesEveryDocumentedPrefixToItsServiceAndStripsApiPrefix() throws Exception {
        for (Route route : documentedRoutes()) {
            HttpResponse<String> response = send(route.method(), route.path(), route.token(), "{}", Map.of());
            assertThat(response.statusCode()).as(route.method() + " " + route.path()).isEqualTo(200);
            JsonNode echo = JSON.readTree(response.body());
            assertThat(echo.get("service").asString()).as(route.path()).startsWith(route.expectedService());
            assertThat(echo.get("path").asString()).isEqualTo(route.expectedPath());
        }
    }

    @Test
    @Timeout(60)
    void routesManyConcurrentRequestsToTheRightService() throws Exception {
        // routing-service bị giới hạn 2 request đồng thời trong test này (xem test bulkhead) nên không đưa vào
        List<Route> routes = documentedRoutes().stream()
                .filter(route -> !route.expectedService().equals("routing-service"))
                .toList();
        int total = 1000;
        // Tối đa 200 request cùng lúc: service giả lập (HttpServer của JDK) không nhận nổi nhiều kết nối
        // mới hơn thế trên macOS (hàng đợi accept bị giới hạn 128)
        Semaphore concurrency = new Semaphore(200);
        try (ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<String>> results = new ArrayList<>();
            for (int i = 0; i < total; i++) {
                Route route = routes.get(i % routes.size());
                results.add(pool.submit(() -> {
                    concurrency.acquire();
                    try {
                        HttpResponse<String> response = send(route.method(), route.path(), route.token(), "{}", Map.of());
                        JsonNode echo = JSON.readTree(response.body());
                        boolean ok = response.statusCode() == 200
                                && echo.get("service").asString().startsWith(route.expectedService())
                                && echo.get("path").asString().equals(route.expectedPath());
                        return ok ? "OK" : route.path() + " -> " + response.statusCode() + " " + response.body();
                    } finally {
                        concurrency.release();
                    }
                }));
            }
            for (Future<String> result : results) {
                assertThat(result.get()).isEqualTo("OK");
            }
        }
    }

    @Test
    void forwardsQueryAndHeadersUnchangedAndDropsServiceToken() throws Exception {
        String rider = TOKENS.rider(RIDER_ID);
        String requestId = UUID.randomUUID().toString();
        String idempotencyKey = UUID.randomUUID().toString();
        HttpResponse<String> response = send("GET", "/api/v1/trips/history?limit=5&status=COMPLETED", rider, null,
                Map.of("X-Request-Id", requestId, "Idempotency-Key", idempotencyKey,
                        "X-Service-Token", "client-must-not-forge-this"));

        JsonNode echo = JSON.readTree(response.body());
        assertThat(echo.get("query").asString()).isEqualTo("limit=5&status=COMPLETED");
        assertThat(echo.get("authorization").asString()).isEqualTo("Bearer " + rider);
        assertThat(echo.get("idempotencyKey").asString()).isEqualTo(idempotencyKey);
        assertThat(echo.get("requestId").asString()).isEqualTo(requestId);
        assertThat(echo.get("serviceToken").isNull()).isTrue();
        assertThat(response.headers().allValues("X-Request-Id")).containsExactly(requestId);
    }

    @Test
    void loadBalancesAcrossInstances() throws Exception {
        USER_A.reset();
        USER_B.reset();
        for (int i = 0; i < 10; i++) {
            assertThat(send("GET", "/api/v1/users/me", TOKENS.rider(RIDER_ID), null, Map.of()).statusCode()).isEqualTo(200);
        }
        assertThat(USER_A.hits()).isEqualTo(5);
        assertThat(USER_B.hits()).isEqualTo(5);
    }

    @Test
    void failsOverToLiveInstanceAndResendsTheSameBody() throws Exception {
        for (int i = 0; i < 6; i++) {
            String body = "{\"quoteId\":\"10000000-0000-4000-8000-00000000000" + i + "\"}";
            HttpResponse<String> response = send("POST", "/api/v1/trips", TOKENS.rider(RIDER_ID), body,
                    Map.of("Idempotency-Key", UUID.randomUUID().toString()));
            assertThat(response.statusCode()).isEqualTo(201);
            assertThat(JSON.readTree(response.body()).get("body").asString()).isEqualTo(body);
            // Location của service được đổi sang đường dẫn public
            assertThat(response.headers().firstValue("Location"))
                    .hasValue("/api/v1/trips/20000000-0000-4000-8000-000000000001");
        }
    }

    @Test
    @Timeout(30)
    void rejectsWith503WhenServiceIsSaturated() throws Exception {
        ROUTING.reset();
        String rider = TOKENS.rider(RIDER_ID);
        try (ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<HttpResponse<String>>> results = new ArrayList<>();
            for (int i = 0; i < 8; i++) {
                results.add(pool.submit(() -> send("POST", "/api/v1/routes?sleep=600", rider, "{}", Map.of())));
            }
            int rejected = 0;
            for (Future<HttpResponse<String>> result : results) {
                HttpResponse<String> response = result.get();
                if (response.statusCode() == 503) {
                    rejected++;
                    assertThat(response.headers().firstValue("Retry-After")).hasValue("1");
                    assertErrorCode(response, "DEPENDENCY_UNAVAILABLE");
                } else {
                    assertThat(response.statusCode()).isEqualTo(200);
                }
            }
            assertThat(rejected).isPositive();
        }
        assertThat(ROUTING.maxInFlight()).isLessThanOrEqualTo(2);
    }

    // ---------- Xác thực & phân quyền ----------

    @Test
    void requiresTokenForProtectedRoutes() throws Exception {
        HttpResponse<String> response = send("GET", "/api/v1/trips/active", null, null, Map.of());
        assertThat(response.statusCode()).isEqualTo(401);
        assertErrorCode(response, "UNAUTHENTICATED");
        assertThat(JSON.readTree(response.body()).at("/meta/requestId").asString()).hasSize(36);
    }

    @Test
    void enforcesRolesFromApiDocs() throws Exception {
        String rider = TOKENS.rider(RIDER_ID);
        String driver = TOKENS.driver(DRIVER_ID);
        String tripId = UUID.randomUUID().toString();
        assertThat(send("GET", "/api/v1/drivers/me", rider, null, Map.of()).statusCode()).isEqualTo(403);
        assertThat(send("GET", "/api/v1/users/me", driver, null, Map.of()).statusCode()).isEqualTo(403);
        assertThat(send("POST", "/api/v1/trips/estimate", driver, "{}", Map.of()).statusCode()).isEqualTo(403);
        assertThat(send("POST", "/api/v1/trips", driver, "{}", Map.of()).statusCode()).isEqualTo(403);
        HttpResponse<String> riderUpdatingStatus = send("PATCH", "/api/v1/trips/" + tripId + "/status", rider, "{}", Map.of());
        assertThat(riderUpdatingStatus.statusCode()).isEqualTo(403);
        assertErrorCode(riderUpdatingStatus, "FORBIDDEN_ACTION");
    }

    @Test
    void rejectsForgedOrForeignTokens() throws Exception {
        assertThat(send("GET", "/api/v1/users/me", TOKENS.driverIssuerClaimingRider(RIDER_ID), null, Map.of()).statusCode())
                .isEqualTo(401);
        assertThat(send("GET", "/api/v1/users/me", TOKENS.unknownIssuer(RIDER_ID), null, Map.of()).statusCode())
                .isEqualTo(401);
        assertThat(send("GET", "/api/v1/users/me", TOKENS.expiredRider(RIDER_ID), null, Map.of()).statusCode())
                .isEqualTo(401);
    }

    @Test
    void publicEndpointsIgnoreExpiredAccessToken() throws Exception {
        String expired = TOKENS.expiredRider(RIDER_ID);
        HttpResponse<String> response = send("POST", "/api/v1/auth/refresh", expired, "{\"refreshToken\":\"x\"}", Map.of());
        assertThat(response.statusCode()).isEqualTo(200);
        // Header vẫn được chuyển nguyên vẹn, service tự quyết định
        assertThat(JSON.readTree(response.body()).get("authorization").asString()).isEqualTo("Bearer " + expired);
    }

    @Test
    void neverExposesUndocumentedOrInternalPaths() throws Exception {
        String rider = TOKENS.rider(RIDER_ID);
        assertThat(send("GET", "/api/v1/internal/users/" + RIDER_ID + "/profile", rider, null, Map.of()).statusCode())
                .isEqualTo(403);
        assertThat(send("GET", "/api/v1/auth/login", null, null, Map.of()).statusCode()).isEqualTo(401);
        assertThat(send("GET", "/api/v1/unknown", rider, null, Map.of()).statusCode()).isEqualTo(403);
    }

    // ---------- Request ID, CORS, giới hạn body ----------

    @Test
    void generatesRequestIdWhenMissingAndRejectsMalformedOnes() throws Exception {
        HttpResponse<String> generated = send("POST", "/api/v1/auth/login", null, "{}", Map.of());
        String requestId = generated.headers().firstValue("X-Request-Id").orElseThrow();
        assertThat(UUID.fromString(requestId)).isNotNull();
        assertThat(JSON.readTree(generated.body()).get("requestId").asString()).isEqualTo(requestId);
        assertThat(generated.headers().allValues("X-Request-Id")).hasSize(1);

        HttpResponse<String> malformed = send("POST", "/api/v1/auth/login", null, "{}", Map.of("X-Request-Id", "abc"));
        assertThat(malformed.statusCode()).isEqualTo(400);
        assertErrorCode(malformed, "INVALID_REQUEST");
    }

    @Test
    void gatewayOwnsCorsHeaders() throws Exception {
        HttpRequest preflight = HttpRequest.newBuilder(URI.create(base() + "/api/v1/trips"))
                .method("OPTIONS", HttpRequest.BodyPublishers.noBody())
                .header("Origin", "http://localhost:5500")
                .header("Access-Control-Request-Method", "POST")
                .header("Access-Control-Request-Headers", "authorization,content-type,idempotency-key,x-request-id")
                .build();
        HttpResponse<String> response = http.send(preflight, HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.headers().firstValue("Access-Control-Allow-Headers").orElse("").toLowerCase())
                .contains("idempotency-key");

        HttpResponse<String> actual = send("GET", "/api/v1/users/me", TOKENS.rider(RIDER_ID), null,
                Map.of("Origin", "http://localhost:5500"));
        assertThat(actual.headers().allValues("Access-Control-Allow-Origin")).containsExactly("http://localhost:5500");
        assertThat(actual.headers().firstValue("Access-Control-Expose-Headers").orElse("")).contains("Idempotent-Replay");

        HttpResponse<String> withoutOrigin = send("GET", "/api/v1/users/me", TOKENS.rider(RIDER_ID), null, Map.of());
        assertThat(withoutOrigin.headers().allValues("Access-Control-Allow-Origin")).isEmpty();
    }

    @Test
    void offersAreDriverOnlyAndRoutingCredentialCannotBeSpoofed() throws Exception {
        assertThat(send("GET", "/api/v1/matching/offers/active", TOKENS.rider(RIDER_ID), null, Map.of()).statusCode()).isEqualTo(403);
        var response = send("POST", "/api/v1/routes", TOKENS.rider(RIDER_ID), "{}", Map.of("X-Service-Token", "client-spoof"));
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(JSON.readTree(response.body()).get("serviceToken").asString()).isEqualTo("trusted-routing-server-token");
        assertThat(send("POST", "/api/v1/routes/matrix", TOKENS.driver(DRIVER_ID), "{}", Map.of()).statusCode()).isEqualTo(403);
        assertThat(send("POST", "/api/v1/internal/matching/requests", TOKENS.driver(DRIVER_ID), "{}", Map.of()).statusCode()).isEqualTo(403);
    }

    @Test
    void rejectsOversizedBodies() throws Exception {
        String body = "{\"x\":\"" + "a".repeat(300 * 1024) + "\"}";
        HttpResponse<String> response = send("POST", "/api/v1/auth/login", null, body, Map.of());
        assertThat(response.statusCode()).isEqualTo(413);
        assertErrorCode(response, "PAYLOAD_TOO_LARGE");
    }

    // ---------- Endpoint nội bộ ----------

    static final String VALID_EVENT = """
            {"schemaVersion":1,"eventId":"60000000-0000-4000-8000-000000000002","type":"trip.assigned",
             "tripId":"20000000-0000-4000-8000-000000000001","tripVersion":2,"occurredAt":"2026-10-05T02:02:00Z",
             "data":{"riderId":"30000000-0000-4000-8000-000000000001",
                     "driverId":"40000000-0000-4000-8000-000000000001","status":"ASSIGNED"}}""";

    @Test
    void internalEndpointsAreOnlyServedOnInternalPort() throws Exception {
        HttpResponse<String> onPublicPort = post(base(), "/internal/events/trips", VALID_EVENT, TRIP_SERVICE_TOKEN);
        assertThat(onPublicPort.statusCode()).isEqualTo(404);

        HttpResponse<String> apiOnInternalPort = http.send(HttpRequest.newBuilder(
                URI.create(internalBase() + "/api/v1/trips/active")).header("Authorization",
                "Bearer " + TOKENS.rider(RIDER_ID)).build(), HttpResponse.BodyHandlers.ofString());
        assertThat(apiOnInternalPort.statusCode()).isEqualTo(404);
    }

    @Test
    void internalEndpointRequiresServiceToken() throws Exception {
        HttpResponse<String> missing = post(internalBase(), "/internal/events/trips", VALID_EVENT, null);
        assertThat(missing.statusCode()).isEqualTo(401);
        assertErrorCode(missing, "INVALID_SERVICE_CREDENTIAL");

        HttpResponse<String> wrong = post(internalBase(), "/internal/events/trips", VALID_EVENT,
                "wrong-token-wrong-token-wrong-token-123");
        assertThat(wrong.statusCode()).isEqualTo(401);

        // JWT người dùng không thay được service token
        HttpResponse<String> userJwt = http.send(HttpRequest.newBuilder(URI.create(internalBase() + "/internal/events/trips"))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + TOKENS.rider(RIDER_ID))
                .POST(HttpRequest.BodyPublishers.ofString(VALID_EVENT)).build(), HttpResponse.BodyHandlers.ofString());
        assertThat(userJwt.statusCode()).isEqualTo(401);
    }

    @Test
    void acceptsValidTripEvent() throws Exception {
        when(inbox.store(any(TripEvent.class))).thenReturn(TripEventInbox.Outcome.ACCEPTED);
        HttpResponse<String> response = post(internalBase(), "/internal/events/trips", VALID_EVENT, TRIP_SERVICE_TOKEN);
        assertThat(response.statusCode()).isEqualTo(202);
        JsonNode body = JSON.readTree(response.body());
        assertThat(body.at("/data/eventId").asString()).isEqualTo("60000000-0000-4000-8000-000000000002");
        assertThat(body.at("/data/accepted").asBoolean()).isTrue();
        assertThat(body.at("/meta/requestId").asString()).hasSize(36);
    }

    @Test
    void rejectsInvalidTripEventWithFieldDetails() throws Exception {
        String invalid = VALID_EVENT.replace("\"riderId\":\"30000000-0000-4000-8000-000000000001\",", "");
        HttpResponse<String> response = post(internalBase(), "/internal/events/trips", invalid, TRIP_SERVICE_TOKEN);
        assertThat(response.statusCode()).isEqualTo(400);
        assertErrorCode(response, "INVALID_REQUEST");
        assertThat(response.body()).contains("data.riderId");
    }

    @Test
    void rejectsReusedEventIdWithDifferentContent() throws Exception {
        when(inbox.store(any(TripEvent.class))).thenReturn(TripEventInbox.Outcome.CONFLICT);
        HttpResponse<String> response = post(internalBase(), "/internal/events/trips", VALID_EVENT, TRIP_SERVICE_TOKEN);
        assertThat(response.statusCode()).isEqualTo(409);
        assertErrorCode(response, "EVENT_ID_REUSED");
    }

    // ---------- Tiện ích ----------

    String base() {
        return "http://127.0.0.1:" + port;
    }

    String internalBase() {
        return "http://127.0.0.1:" + INTERNAL_PORT;
    }

    HttpResponse<String> send(String method, String path, String token, String body, Map<String, String> headers)
            throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(base() + path))
                .timeout(Duration.ofSeconds(10))
                .method(method, body == null
                        ? HttpRequest.BodyPublishers.noBody()
                        : HttpRequest.BodyPublishers.ofString(body));
        if (body != null) {
            builder.header("Content-Type", "application/json");
        }
        if (token != null) {
            builder.header("Authorization", "Bearer " + token);
        }
        headers.forEach(builder::header);
        return http.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    }

    HttpResponse<String> post(String base, String path, String body, String serviceToken) throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(base + path))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body));
        if (serviceToken != null) {
            builder.header("X-Service-Token", serviceToken);
        }
        return http.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    }

    static void assertErrorCode(HttpResponse<String> response, String code) {
        JsonNode body = JSON.readTree(response.body());
        assertThat(body.at("/error/code").asString()).isEqualTo(code);
        assertThat(body.at("/error/details").isArray()).isTrue();
    }
}
