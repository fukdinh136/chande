package com.chande.userservice.adapter.http;

import com.chande.userservice.adapter.security.Rs256AccessTokenIssuer;
import com.chande.userservice.adapter.security.Rs256JwtVerifier;
import com.chande.userservice.adapter.security.RsaKeys;
import com.chande.userservice.adapter.support.TestKeys;
import com.chande.userservice.application.auth.AuthService;
import com.chande.userservice.testing.InMemoryWorld;
import com.sun.net.httpserver.HttpServer;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest.BodyPublishers;
import java.net.http.HttpResponse;
import java.net.http.HttpResponse.BodyHandlers;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.BooleanSupplier;

/** HttpServer thật ở cổng ngẫu nhiên + use case thật + repo in-memory + RS256 thật. */
final class HttpFixture implements AutoCloseable {

    static final String ISSUER = "https://identity.example.invalid/rider";
    static final String INTERNAL_KEY = "internal-key-for-tests-0123456789";
    static final int MAX_BODY_BYTES = 4096;
    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    final InMemoryWorld world = new InMemoryWorld();
    final RsaKeys keys = RsaKeys.of("test-kid", TestKeys.privateKey(TestKeys.CURRENT), Map.of());
    final Rs256AccessTokenIssuer issuer =
            new Rs256AccessTokenIssuer(keys.current(), ISSUER, List.of(), Duration.ofMinutes(15));
    final AuthService auth = new AuthService(world.users, world.refreshTokens, world.hasher, issuer,
            world.refreshTokenFactory, world.ids, world.tx, world.clock, InMemoryWorld.REFRESH_TTL);
    volatile BooleanSupplier databaseHealth = () -> true;

    private final HttpServer server;
    private final HttpClient client = HttpClient.newHttpClient();
    private final String baseUrl;

    HttpFixture() throws IOException {
        Rs256JwtVerifier verifier = new Rs256JwtVerifier(keys.all(), ISSUER, Duration.ofSeconds(60), world.clock);
        Router router = Routes.build(auth, world.profile, world.address, keys.jwks(),
                () -> databaseHealth.getAsBoolean(), new BearerAuthenticator(verifier),
                new InternalKeyAuthenticator(INTERNAL_KEY), MAX_BODY_BYTES);
        server = UserHttpServer.start(new InetSocketAddress("127.0.0.1", 0), router);
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @Override
    public void close() {
        server.stop(0);
        client.close();
    }

    String accessToken(UUID userId) {
        return issuer.issue(userId, world.clock.instant()).value();
    }

    Call call(String method, String path) {
        return new Call(method, path);
    }

    static JsonNode json(String body) {
        return MAPPER.readTree(body);
    }

    final class Call {
        private final java.net.http.HttpRequest.Builder builder;
        private final String method;
        private String body;

        private Call(String method, String path) {
            this.method = method;
            this.builder = java.net.http.HttpRequest.newBuilder(URI.create(baseUrl + path));
        }

        Call header(String name, String value) {
            builder.header(name, value);
            return this;
        }

        Call bearer(UUID userId) {
            return header("Authorization", "Bearer " + accessToken(userId));
        }

        Call internalKey() {
            return header("X-Internal-Key", INTERNAL_KEY);
        }

        /** Body JSON kèm Content-Type: application/json. */
        Call json(String json) {
            header("Content-Type", "application/json");
            return rawBody(json);
        }

        Call rawBody(String raw) {
            this.body = raw;
            return this;
        }

        HttpResponse<String> send() {
            try {
                builder.method(method, body == null ? BodyPublishers.noBody() : BodyPublishers.ofString(body));
                return client.send(builder.build(), BodyHandlers.ofString());
            } catch (IOException | InterruptedException e) {
                throw new IllegalStateException(e);
            }
        }
    }
}
