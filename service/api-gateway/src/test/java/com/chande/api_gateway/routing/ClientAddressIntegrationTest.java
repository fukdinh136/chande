package com.chande.api_gateway.routing;

import com.chande.api_gateway.realtime.TripEventInbox;
import com.chande.api_gateway.support.StubService;
import com.chande.api_gateway.support.TestTokens;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
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
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * IP thật của client: edge đặt X-Forwarded-For, Gateway (Tomcat, forward-headers native) tin header đó vì
 * kết nối đến từ loopback, rồi dùng IP này cho rate limit và chuyển xuống Driver.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ClientAddressIntegrationTest {

    static final StubService DRIVER = StubService.start("driver-service");
    static final TestTokens TOKENS = new TestTokens();
    static final String PROXY_TOKEN = "test-driver-proxy-token-0123456789abcdef";
    static final JsonMapper JSON = JsonMapper.builder().build();

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("gateway.routing.services.driver-service.instances", DRIVER::url);
        registry.add("gateway.routing.services.driver-service.client-address.token", () -> PROXY_TOKEN);
        registry.add("gateway.internal.port", StubService::freePort);
        registry.add("jwt.issuers[0].issuer", () -> TestTokens.RIDER_ISSUER);
        registry.add("jwt.issuers[0].jwk-set-uri", TOKENS::riderJwksUri);
        registry.add("jwt.issuers[0].roles", () -> "RIDER");
        registry.add("jwt.issuers[1].issuer", () -> TestTokens.DRIVER_ISSUER);
        registry.add("jwt.issuers[1].jwk-set-uri", TOKENS::driverJwksUri);
        registry.add("jwt.issuers[1].roles", () -> "DRIVER");
        registry.add("rate-limit.auth.max-attempts", () -> 2);
    }

    @AfterAll
    static void stop() {
        DRIVER.close();
        TOKENS.close();
    }

    @MockitoBean
    TripEventInbox inbox;

    @LocalServerPort
    int port;

    final HttpClient http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build();

    HttpResponse<String> otp(String forwardedFor, String spoofIp, String spoofToken) throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/v1/driver-auth/otp/request"))
                .timeout(Duration.ofSeconds(10))
                .header("Content-Type", "application/json")
                .header("X-Request-Id", UUID.randomUUID().toString())
                .header("X-Forwarded-For", forwardedFor)
                .POST(HttpRequest.BodyPublishers.ofString("{}"));
        if (spoofIp != null) {
            builder.header("X-Driver-Client-IP", spoofIp).header("X-Driver-Proxy-Token", spoofToken);
        }
        return http.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void forwardsTheEdgeSuppliedAddressToDriverAndReplacesClientSpoofs() throws Exception {
        HttpResponse<String> response = otp("203.0.113.7", "198.51.100.66", "guessed-token");
        assertThat(response.statusCode()).isEqualTo(200);
        JsonNode echo = JSON.readTree(response.body());
        assertThat(echo.get("driverClientIp").asString()).isEqualTo("203.0.113.7");
        assertThat(echo.get("driverProxyToken").asString()).isEqualTo(PROXY_TOKEN);
    }

    @Test
    void authRateLimitCountsEachForwardedClientSeparately() throws Exception {
        assertThat(otp("203.0.113.20", null, null).statusCode()).isEqualTo(200);
        assertThat(otp("203.0.113.20", null, null).statusCode()).isEqualTo(200);
        assertThat(otp("203.0.113.20", null, null).statusCode()).isEqualTo(429);
        // Before forwarded headers every client behind the edge shared one budget and this was 429 too.
        assertThat(otp("203.0.113.21", null, null).statusCode()).isEqualTo(200);
    }
}
