package com.chande.api_gateway.realtime;

import com.chande.api_gateway.error.ErrorCode;
import com.chande.api_gateway.security.JwtProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.adapter.NativeWebSocketSession;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Endpoint {@code /ws} cho Customer App và Driver App (giao thức đề xuất, chờ nhóm chốt — xem README).
 * <p>
 * Xác thực: header {@code Authorization: Bearer} lúc handshake (app mobile), hoặc tin nhắn đầu tiên
 * {@code {"type":"auth","token":"..."}} (trình duyệt không đặt được header cho WebSocket). Token không đặt
 * trên URL để không lộ qua log. Token hết hạn thì kết nối bị đóng; app gửi lại "auth" với token mới để gia hạn.
 */
@Component
public class RealtimeWebSocketHandler extends TextWebSocketHandler implements DisposableBean {

    static final CloseStatus UNAUTHENTICATED = new CloseStatus(4401, "UNAUTHENTICATED");
    static final CloseStatus AUTH_TIMEOUT = new CloseStatus(4401, "AUTH_TIMEOUT");
    static final CloseStatus TOKEN_EXPIRED = new CloseStatus(4401, "TOKEN_EXPIRED");
    static final CloseStatus IDENTITY_CHANGED = new CloseStatus(4401, "IDENTITY_CHANGED");
    static final CloseStatus TOO_MANY_CONNECTIONS = new CloseStatus(4429, "TOO_MANY_CONNECTIONS");

    private static final Logger log = LoggerFactory.getLogger(RealtimeWebSocketHandler.class);
    private static final Set<String> ROLES = Set.of("RIDER", "DRIVER");
    private static final int SEND_TIME_LIMIT_MS = 5_000;
    private static final int SEND_BUFFER_LIMIT_BYTES = 64 * 1024;
    private static final String TOMCAT_BLOCKING_SEND_TIMEOUT = "org.apache.tomcat.websocket.BLOCKING_SEND_TIMEOUT";

    private final JwtDecoder jwtDecoder;
    private final SessionRegistry registry;
    private final LocationForwarder locationForwarder;
    private final RealtimeProperties properties;
    private final Duration clockSkew;
    private final JsonMapper jsonMapper;
    private final Clock clock = Clock.systemUTC();
    private final Map<String, Client> clients = new ConcurrentHashMap<>();
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(
            runnable -> Thread.ofPlatform().daemon().name("ws-housekeeping").unstarted(runnable));

    public RealtimeWebSocketHandler(JwtDecoder jwtDecoder, SessionRegistry registry, LocationForwarder locationForwarder,
                                    RealtimeProperties properties, JwtProperties jwtProperties, JsonMapper jsonMapper) {
        this.jwtDecoder = jwtDecoder;
        this.registry = registry;
        this.locationForwarder = locationForwarder;
        this.properties = properties;
        this.clockSkew = jwtProperties.clockSkew();
        this.jsonMapper = jsonMapper;
        scheduler.scheduleWithFixedDelay(this::closeExpiredSessions, 5, 5, TimeUnit.SECONDS);
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        limitBlockingSendTime(session);
        // Decorator cho phép nhiều luồng gửi an toàn; client đọc chậm quá giới hạn thì bị đóng
        Client client = new Client(
                new ConcurrentWebSocketSessionDecorator(session, SEND_TIME_LIMIT_MS, SEND_BUFFER_LIMIT_BYTES));
        clients.put(session.getId(), client);

        if (session.getPrincipal() instanceof JwtAuthenticationToken authentication) {
            authenticate(client, authentication.getToken());
        } else {
            scheduler.schedule(() -> {
                if (!client.isAuthenticated()) {
                    close(client, AUTH_TIMEOUT);
                }
            }, properties.authTimeout().toMillis(), TimeUnit.MILLISECONDS);
        }
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        Client client = clients.get(session.getId());
        if (client == null) {
            return;
        }
        JsonNode node;
        try {
            node = jsonMapper.readTree(message.getPayload());
        } catch (JacksonException e) {
            sendError(client, ErrorCode.INVALID_REQUEST, "Tin nhắn phải là JSON");
            return;
        }
        JsonNode typeNode = node != null && node.isObject() ? node.get("type") : null;
        String type = typeNode != null && typeNode.isString() ? typeNode.asString() : "";
        switch (type) {
            case "ping" -> send(client, Map.of("type", "pong"));
            case "auth" -> handleAuth(client, node);
            case "location.update" -> handleLocation(client, node);
            default -> sendError(client, ErrorCode.INVALID_REQUEST, "type không được hỗ trợ");
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        Client client = clients.remove(session.getId());
        if (client != null && client.isAuthenticated()) {
            registry.remove(client.userKey(), client.session);
        }
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) {
        log.debug("Lỗi truyền WebSocket {}: {}", session.getId(), exception.getMessage());
    }

    @Override
    public void destroy() {
        scheduler.shutdownNow();
    }

    private void handleAuth(Client client, JsonNode node) {
        JsonNode token = node.get("token");
        if (token == null || !token.isString()) {
            close(client, UNAUTHENTICATED);
            return;
        }
        try {
            authenticate(client, jwtDecoder.decode(token.asString()));
        } catch (JwtException e) {
            log.debug("Token WebSocket không hợp lệ: {}", e.getMessage());
            close(client, UNAUTHENTICATED);
        }
    }

    private void authenticate(Client client, Jwt jwt) {
        String role = jwt.getClaimAsString("role");
        Instant expiresAt = jwt.getExpiresAt();
        if (!ROLES.contains(role) || expiresAt == null) {
            close(client, UNAUTHENTICATED);
            return;
        }
        UUID userId = UUID.fromString(jwt.getSubject());
        if (client.isAuthenticated()) {
            // Gửi lại "auth" để gia hạn: phải cùng một người dùng
            if (!client.role.equals(role) || !client.userId.equals(userId)) {
                close(client, IDENTITY_CHANGED);
                return;
            }
            client.expiresAt = expiresAt;
        } else {
            if (!registry.add(SessionRegistry.userKey(role, userId), client.session, properties.maxSessionsPerUser())) {
                close(client, TOO_MANY_CONNECTIONS);
                return;
            }
            client.userId = userId;
            client.expiresAt = expiresAt;
            client.role = role;
        }
        Map<String, Object> ok = new LinkedHashMap<>();
        ok.put("type", "auth.ok");
        ok.put("userId", userId.toString());
        ok.put("role", role);
        ok.put("expiresAt", expiresAt.toString());
        send(client, ok);
    }

    private void handleLocation(Client client, JsonNode node) {
        if (!client.isAuthenticated()) {
            sendError(client, ErrorCode.UNAUTHENTICATED, "Cần gửi auth trước");
            return;
        }
        if (!"DRIVER".equals(client.role)) {
            sendError(client, ErrorCode.FORBIDDEN_ACTION, "Chỉ tài xế được gửi vị trí");
            return;
        }
        long now = System.nanoTime();
        if (client.lastLocationNanos != 0 && now - client.lastLocationNanos < properties.locationMinInterval().toNanos()) {
            return; // gửi quá dày: bỏ bớt, không báo lỗi để tránh dội tin nhắn ngược lại
        }
        try {
            DriverLocation location = new DriverLocation(client.userId,
                    requiredNumber(node, "lat", -90, 90),
                    requiredNumber(node, "lng", -180, 180),
                    optionalNumber(node, "heading", 0, 360),
                    optionalNumber(node, "speed", 0, Double.MAX_VALUE),
                    optionalNumber(node, "accuracy", 0, Double.MAX_VALUE),
                    optionalInstant(node, "recordedAt"),
                    clock.instant());
            client.lastLocationNanos = now;
            locationForwarder.forward(location);
        } catch (InvalidMessageException e) {
            sendError(client, ErrorCode.INVALID_REQUEST, e.getMessage());
        }
    }

    private void closeExpiredSessions() {
        Instant now = clock.instant();
        for (Client client : clients.values()) {
            if (client.isAuthenticated() && now.isAfter(client.expiresAt.plus(clockSkew))) {
                close(client, TOKEN_EXPIRED);
            }
        }
    }

    private void send(Client client, Object payload) {
        try {
            client.session.sendMessage(new TextMessage(jsonMapper.writeValueAsString(payload)));
        } catch (IOException | IllegalStateException e) {
            log.debug("Không gửi được tin nhắn WebSocket: {}", e.getMessage());
        }
    }

    private void sendError(Client client, ErrorCode code, String message) {
        Map<String, Object> error = new LinkedHashMap<>();
        error.put("type", "error");
        error.put("code", code.name());
        error.put("message", message);
        send(client, error);
    }

    private static void close(Client client, CloseStatus status) {
        try {
            client.session.close(status);
        } catch (IOException | IllegalStateException e) {
            log.debug("Không đóng được kết nối WebSocket: {}", e.getMessage());
        }
    }

    /** Giới hạn thời gian ghi xuống một client chậm để không chặn luồng đẩy sự kiện cho người khác. */
    private static void limitBlockingSendTime(WebSocketSession session) {
        if (session instanceof NativeWebSocketSession nativeSession) {
            jakarta.websocket.Session tomcatSession = nativeSession.getNativeSession(jakarta.websocket.Session.class);
            if (tomcatSession != null) {
                tomcatSession.getUserProperties().put(TOMCAT_BLOCKING_SEND_TIMEOUT, (long) SEND_TIME_LIMIT_MS);
            }
        }
    }

    private static double requiredNumber(JsonNode node, String field, double min, double max) {
        Double value = optionalNumber(node, field, min, max);
        if (value == null) {
            throw new InvalidMessageException(field + " là bắt buộc");
        }
        return value;
    }

    private static Double optionalNumber(JsonNode node, String field, double min, double max) {
        JsonNode value = node.get(field);
        if (value == null || value.isNull()) {
            return null;
        }
        if (!value.isNumber() || value.asDouble() < min || value.asDouble() > max) {
            throw new InvalidMessageException(field + " không hợp lệ");
        }
        return value.asDouble();
    }

    private static Instant optionalInstant(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || value.isNull()) {
            return null;
        }
        try {
            if (value.isString()) {
                return Instant.parse(value.asString());
            }
        } catch (DateTimeParseException ignored) {
            // rơi xuống báo lỗi
        }
        throw new InvalidMessageException(field + " phải là thời gian ISO 8601");
    }

    private static final class Client {
        final WebSocketSession session;
        volatile String role;
        volatile UUID userId;
        volatile Instant expiresAt;
        /** Chỉ đọc/ghi trong luồng xử lý tin nhắn của chính kết nối này. */
        long lastLocationNanos;

        Client(WebSocketSession session) {
            this.session = session;
        }

        boolean isAuthenticated() {
            return role != null;
        }

        String userKey() {
            return SessionRegistry.userKey(role, userId);
        }
    }

    private static final class InvalidMessageException extends RuntimeException {
        InvalidMessageException(String message) {
            super(message, null, false, false);
        }
    }
}
