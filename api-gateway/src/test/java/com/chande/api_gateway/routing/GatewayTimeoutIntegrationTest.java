package com.chande.api_gateway.routing;

import com.chande.api_gateway.support.StubService;
import com.chande.api_gateway.support.TestTokens;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** Service chậm hoặc chết giữa chừng: client luôn nhận envelope lỗi của gateway, không treo. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class GatewayTimeoutIntegrationTest {

    static final StubService TRIP = StubService.start("trip-service");
    static final TestTokens TOKENS = new TestTokens();
    static final JsonMapper JSON = JsonMapper.builder().build();

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("gateway.routing.services.trip-service.instances", TRIP::url);
        registry.add("gateway.routing.read-timeout", () -> "500ms");
        registry.add("gateway.internal.port", StubService::freePort);
        registry.add("jwt.issuers[0].issuer", () -> TestTokens.RIDER_ISSUER);
        registry.add("jwt.issuers[0].jwk-set-uri", TOKENS::riderJwksUri);
        registry.add("jwt.issuers[0].roles", () -> "RIDER");
    }

    @AfterAll
    static void stop() {
        TRIP.close();
        TOKENS.close();
    }

    @LocalServerPort
    int port;

    HttpResponse<String> get(String path) throws Exception {
        return HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                .header("Authorization", "Bearer " + TOKENS.rider(UUID.randomUUID())).build(),
                HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void slowServiceTimesOutWith504() throws Exception {
        HttpResponse<String> response = get("/api/v1/trips/active?sleep=1500");
        assertThat(response.statusCode()).isEqualTo(504);
        assertThat(JSON.readTree(response.body()).at("/error/code").asString()).isEqualTo("GATEWAY_TIMEOUT");
    }

    @Test
    void serviceDyingMidResponseStillGivesGatewayError() throws Exception {
        HttpResponse<String> response = get("/api/v1/trips/active?sleepBody=1500");
        // JDK 21 báo "stream closed" (503), JDK mới hơn báo đúng là timeout (504); cả hai đều là lỗi của gateway,
        // không phải trang 500 mặc định hay body bị cắt dở
        JsonNode body = JSON.readTree(response.body());
        if (response.statusCode() == 504) {
            assertThat(body.at("/error/code").asString()).isEqualTo("GATEWAY_TIMEOUT");
        } else {
            assertThat(response.statusCode()).isEqualTo(503);
            assertThat(body.at("/error/code").asString()).isEqualTo("DEPENDENCY_UNAVAILABLE");
        }
        assertThat(body.at("/meta/requestId").asString())
                .isEqualTo(response.headers().firstValue("X-Request-Id").orElseThrow());
    }
}
