package com.chande.api_gateway.support;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Service giả lập: trả lại JSON mô tả request nhận được (service nào, đường dẫn, header, body)
 * để test kiểm tra gateway định tuyến và chuyển tiếp đúng. Query {@code sleep=<ms>} làm service trả lời chậm,
 * {@code sleepBody=<ms>} gửi header ngay nhưng body chậm.
 */
public final class StubService implements AutoCloseable {

    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final String name;
    private final HttpServer server;
    private final AtomicInteger hits = new AtomicInteger();
    private final AtomicInteger inFlight = new AtomicInteger();
    private final AtomicInteger maxInFlight = new AtomicInteger();

    private StubService(String name) throws IOException {
        this.name = name;
        this.server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 512);
        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        server.createContext("/", this::handle);
        server.start();
    }

    public static StubService start(String name) {
        try {
            return new StubService(name);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    public String url() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    public int hits() {
        return hits.get();
    }

    public int maxInFlight() {
        return maxInFlight.get();
    }

    public void reset() {
        hits.set(0);
        maxInFlight.set(0);
    }

    /** URL của một cổng không có ai lắng nghe: kết nối tới sẽ bị từ chối. */
    public static String deadUrl() {
        try (ServerSocket socket = new ServerSocket(0)) {
            return "http://127.0.0.1:" + socket.getLocalPort();
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    public static int freePort() {
        try (ServerSocket socket = new ServerSocket(0)) {
            return socket.getLocalPort();
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    private void handle(HttpExchange exchange) throws IOException {
        hits.incrementAndGet();
        maxInFlight.accumulateAndGet(inFlight.incrementAndGet(), Math::max);
        try {
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            String query = exchange.getRequestURI().getRawQuery();
            if (query != null && query.startsWith("sleep=")) {
                Thread.sleep(Long.parseLong(query.substring(6)));
            }
            if (query != null && query.startsWith("sleepBody=")) {
                // Gửi status/header ngay, treo phần body: tái hiện service chết giữa chừng
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, 0);
                Thread.sleep(Long.parseLong(query.substring(10)));
                exchange.getResponseBody().write("{}".getBytes(StandardCharsets.UTF_8));
                return;
            }
            Map<String, Object> echo = new LinkedHashMap<>();
            echo.put("service", name);
            echo.put("method", exchange.getRequestMethod());
            echo.put("path", exchange.getRequestURI().getRawPath());
            echo.put("query", query);
            echo.put("body", body);
            echo.put("authorization", exchange.getRequestHeaders().getFirst("Authorization"));
            echo.put("idempotencyKey", exchange.getRequestHeaders().getFirst("Idempotency-Key"));
            echo.put("requestId", exchange.getRequestHeaders().getFirst("X-Request-Id"));
            echo.put("serviceToken", exchange.getRequestHeaders().getFirst("X-Service-Token"));
            byte[] response = JSON.writeValueAsBytes(echo);

            exchange.getResponseHeaders().add("Content-Type", "application/json");
            // Giống một service NestJS bật CORS và trả lại X-Request-Id: gateway phải bỏ các header này
            exchange.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
            String requestId = exchange.getRequestHeaders().getFirst("X-Request-Id");
            if (requestId != null) {
                exchange.getResponseHeaders().add("X-Request-Id", requestId);
            }
            if ("POST".equals(exchange.getRequestMethod()) && "/trips".equals(exchange.getRequestURI().getPath())) {
                exchange.getResponseHeaders().add("Location", "/trips/20000000-0000-4000-8000-000000000001");
                exchange.sendResponseHeaders(201, response.length);
            } else {
                exchange.sendResponseHeaders(200, response.length);
            }
            exchange.getResponseBody().write(response);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            inFlight.decrementAndGet();
            exchange.close();
        }
    }

    @Override
    public void close() {
        server.stop(0);
    }
}
