package com.chande.api_gateway.realtime;

import com.chande.api_gateway.support.StubService;
import com.chande.api_gateway.support.TestTokens;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.net.Socket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

/**
 * Luồng đầy đủ: Trip POST sự kiện → Redis (chống trùng, chặn version cũ) → Redis Stream → WebSocket của
 * khách và tài xế. Cần Redis ở localhost:6379; không có Redis thì test tự bỏ qua.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class RealtimeRedisIntegrationTest {

    static final TestTokens TOKENS = new TestTokens();
    static final int INTERNAL_PORT = StubService.freePort();
    static final String TRIP_SERVICE_TOKEN = "test-trip-service-token-0123456789abcdef";
    static final JsonMapper JSON = JsonMapper.builder().build();

    @BeforeAll
    static void requireRedis() {
        try (Socket ignored = new Socket("localhost", 6379)) {
            // Redis đang chạy
        } catch (Exception e) {
            Assumptions.abort("Không có Redis ở localhost:6379");
        }
    }

    @AfterAll
    static void stop() {
        TOKENS.close();
    }

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("gateway.internal.port", () -> INTERNAL_PORT);
        registry.add("gateway.internal.callers.trip-service", () -> TRIP_SERVICE_TOKEN);
        registry.add("gateway.realtime.auth-timeout", () -> "1s");
        registry.add("jwt.issuers[0].issuer", () -> TestTokens.RIDER_ISSUER);
        registry.add("jwt.issuers[0].jwk-set-uri", TOKENS::riderJwksUri);
        registry.add("jwt.issuers[0].roles", () -> "RIDER");
        registry.add("jwt.issuers[1].issuer", () -> TestTokens.DRIVER_ISSUER);
        registry.add("jwt.issuers[1].jwk-set-uri", TOKENS::driverJwksUri);
        registry.add("jwt.issuers[1].roles", () -> "DRIVER");
    }

    @MockitoBean
    LocationForwarder locationForwarder;

    @LocalServerPort
    int port;

    final HttpClient http = HttpClient.newHttpClient();
    final UUID riderId = UUID.randomUUID();
    final UUID driverId = UUID.randomUUID();
    final UUID tripId = UUID.randomUUID();

    /** Client WebSocket thu lại mọi tin nhắn và mã đóng kết nối. */
    static final class Client extends TextWebSocketHandler {
        final BlockingQueue<JsonNode> messages = new LinkedBlockingQueue<>();
        final CompletableFuture<CloseStatus> closed = new CompletableFuture<>();
        WebSocketSession session;

        @Override
        protected void handleTextMessage(WebSocketSession session, TextMessage message) {
            messages.add(JSON.readTree(message.getPayload()));
        }

        @Override
        public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
            closed.complete(status);
        }

        void send(String json) throws Exception {
            session.sendMessage(new TextMessage(json));
        }

        JsonNode next() throws InterruptedException {
            JsonNode message = messages.poll(5, TimeUnit.SECONDS);
            assertThat(message).as("chờ tin nhắn WebSocket").isNotNull();
            return message;
        }

        void assertNothingWithin(long millis) throws InterruptedException {
            assertThat(messages.poll(millis, TimeUnit.MILLISECONDS)).isNull();
        }
    }

    Client connect(String bearerToken) throws Exception {
        Client client = new Client();
        WebSocketHttpHeaders headers = new WebSocketHttpHeaders();
        if (bearerToken != null) {
            headers.add("Authorization", "Bearer " + bearerToken);
        }
        client.session = new StandardWebSocketClient()
                .execute(client, headers, URI.create("ws://127.0.0.1:" + port + "/ws"))
                .get(5, TimeUnit.SECONDS);
        return client;
    }

    String event(UUID eventId, String type, String status, long version, UUID driver) {
        return """
                {"schemaVersion":1,"eventId":"%s","type":"%s","tripId":"%s","tripVersion":%d,
                 "occurredAt":"%s","data":{"riderId":"%s","driverId":%s,"status":"%s"}}"""
                .formatted(eventId, type, tripId, version, Instant.now(), riderId,
                        driver == null ? "null" : "\"" + driver + "\"", status);
    }

    HttpResponse<String> postEvent(String body) throws Exception {
        return http.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + INTERNAL_PORT + "/internal/events/trips"))
                .header("Content-Type", "application/json")
                .header("X-Service-Token", TRIP_SERVICE_TOKEN)
                .POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void pushesTripEventsToRiderAndDriverExactlyOnceAndInOrder() throws Exception {
        // Khách xác thực bằng tin nhắn đầu tiên (cách của trình duyệt)
        Client rider = connect(null);
        rider.send("{\"type\":\"auth\",\"token\":\"" + TOKENS.rider(riderId) + "\"}");
        JsonNode riderOk = rider.next();
        assertThat(riderOk.get("type").asString()).isEqualTo("auth.ok");
        assertThat(riderOk.get("userId").asString()).isEqualTo(riderId.toString());

        // Tài xế xác thực bằng header lúc handshake (cách của app mobile)
        Client driver = connect(TOKENS.driver(driverId));
        assertThat(driver.next().get("role").asString()).isEqualTo("DRIVER");

        UUID assignedId = UUID.randomUUID();
        String assigned = event(assignedId, "trip.assigned", "ASSIGNED", 2, driverId);
        HttpResponse<String> accepted = postEvent(assigned);
        assertThat(accepted.statusCode()).isEqualTo(202);
        assertThat(JSON.readTree(accepted.body()).at("/data/eventId").asString()).isEqualTo(assignedId.toString());

        for (Client client : new Client[]{rider, driver}) {
            JsonNode message = client.next();
            assertThat(message.get("type").asString()).isEqualTo("trip.event");
            assertThat(message.at("/event/eventId").asString()).isEqualTo(assignedId.toString());
            assertThat(message.at("/event/tripVersion").asLong()).isEqualTo(2);
            assertThat(message.at("/event/data/status").asString()).isEqualTo("ASSIGNED");
        }

        // Trip retry cùng eventId: vẫn 202 nhưng không đẩy lần hai
        assertThat(postEvent(assigned).statusCode()).isEqualTo(202);
        // Sự kiện đến trễ với version cũ hơn: lưu nhưng không đẩy để UI không lùi trạng thái
        assertThat(postEvent(event(UUID.randomUUID(), "trip.searching", "SEARCHING", 1, null)).statusCode())
                .isEqualTo(202);
        rider.assertNothingWithin(700);
        driver.assertNothingWithin(100);

        // Cùng eventId nhưng nội dung khác
        String reused = event(assignedId, "trip.driver_arrived", "DRIVER_ARRIVED", 3, driverId);
        assertThat(postEvent(reused).statusCode()).isEqualTo(409);

        UUID arrivedId = UUID.randomUUID();
        assertThat(postEvent(event(arrivedId, "trip.driver_arrived", "DRIVER_ARRIVED", 3, driverId)).statusCode())
                .isEqualTo(202);
        assertThat(rider.next().at("/event/eventId").asString()).isEqualTo(arrivedId.toString());
        assertThat(driver.next().at("/event/eventId").asString()).isEqualTo(arrivedId.toString());

        rider.session.close();
        driver.session.close();
    }

    @Test
    void closesUnauthenticatedOrInvalidConnections() throws Exception {
        Client silent = connect(null);
        assertThat(silent.closed.get(5, TimeUnit.SECONDS).getCode()).isEqualTo(4401);

        Client forged = connect(null);
        forged.send("{\"type\":\"auth\",\"token\":\"" + TOKENS.unknownIssuer(riderId) + "\"}");
        assertThat(forged.closed.get(5, TimeUnit.SECONDS).getCode()).isEqualTo(4401);
    }

    @Test
    void reAuthMustKeepTheSameIdentity() throws Exception {
        Client rider = connect(TOKENS.rider(riderId));
        rider.next();
        rider.send("{\"type\":\"auth\",\"token\":\"" + TOKENS.rider(riderId) + "\"}");
        assertThat(rider.next().get("type").asString()).isEqualTo("auth.ok");

        rider.send("{\"type\":\"auth\",\"token\":\"" + TOKENS.rider(UUID.randomUUID()) + "\"}");
        assertThat(rider.closed.get(5, TimeUnit.SECONDS).getReason()).isEqualTo("IDENTITY_CHANGED");
    }

    @Test
    void closesConnectionWhenTokenExpires() throws Exception {
        // Còn hạn theo độ lệch đồng hồ 30 giây nhưng sẽ quá hạn trong vài giây
        Client rider = connect(TOKENS.riderExpiringAt(riderId, Instant.now().minusSeconds(27)));
        rider.next();
        assertThat(rider.closed.get(15, TimeUnit.SECONDS).getReason()).isEqualTo("TOKEN_EXPIRED");
    }

    @Test
    void onlyDriversCanSendLocation() throws Exception {
        Client rider = connect(TOKENS.rider(riderId));
        rider.next();
        rider.send("{\"type\":\"location.update\",\"lat\":10.77,\"lng\":106.70}");
        assertThat(rider.next().get("code").asString()).isEqualTo("FORBIDDEN_ACTION");

        Client driver = connect(TOKENS.driver(driverId));
        driver.next();
        driver.send("{\"type\":\"location.update\",\"lat\":91,\"lng\":106.70}");
        assertThat(driver.next().get("code").asString()).isEqualTo("INVALID_REQUEST");

        driver.send("{\"type\":\"location.update\",\"lat\":10.7769,\"lng\":106.7009,\"heading\":90,\"speed\":8.5}");
        verify(locationForwarder, timeout(2000)).forward(argThat(location ->
                location.driverId().equals(driverId) && location.lat() == 10.7769 && location.heading() == 90));

        driver.send("{\"type\":\"ping\"}");
        assertThat(driver.next().get("type").asString()).isEqualTo("pong");
        rider.session.close();
        driver.session.close();
    }
}
