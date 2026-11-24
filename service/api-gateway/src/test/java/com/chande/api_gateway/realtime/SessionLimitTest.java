package com.chande.api_gateway.realtime;

import com.chande.api_gateway.security.JwtProperties;
import org.junit.jupiter.api.Test;
import org.springframework.util.unit.DataSize;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;
import tools.jackson.databind.json.JsonMapper;

import java.lang.reflect.Proxy;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class SessionLimitTest {

    /** A session stub that records close() and nothing else. */
    private static WebSocketSession session(String id, List<CloseStatus> closed) {
        return (WebSocketSession) Proxy.newProxyInstance(WebSocketSession.class.getClassLoader(), new Class<?>[]{WebSocketSession.class},
                (proxy, method, args) -> switch (method.getName()) {
                    case "getId" -> id;
                    case "close" -> { closed.add(args != null && args.length == 1 ? (CloseStatus) args[0] : CloseStatus.NORMAL); yield null; }
                    case "isOpen" -> true;
                    case "getAttributes" -> new java.util.HashMap<String, Object>();
                    case "hashCode" -> id.hashCode();
                    case "equals" -> proxy == args[0];
                    default -> null;
                });
    }

    @Test
    void connectionsBeyondMaxSessionsAreClosedAsServerBusyBeforeAuth() throws Exception {
        RealtimeProperties properties = new RealtimeProperties(Duration.ofSeconds(10), Duration.ofSeconds(60), 5,
                Duration.ofSeconds(1), DataSize.ofKilobytes(4), Duration.ofDays(1), 1000, 2);
        JwtProperties jwt = new JwtProperties(Duration.ofSeconds(30), List.of(new JwtProperties.Issuer("test", java.net.URI.create("http://jwks.test/keys"), java.util.Set.of("RIDER"), java.util.Set.of())));
        RealtimeWebSocketHandler handler = new RealtimeWebSocketHandler(token -> { throw new AssertionError("no JWT work"); },
                new SessionRegistry(), location -> { }, properties, jwt, JsonMapper.builder().build());
        try {
            List<CloseStatus> closed = new ArrayList<>();
            handler.afterConnectionEstablished(session("a", closed));
            handler.afterConnectionEstablished(session("b", closed));
            assertThat(closed).isEmpty();
            handler.afterConnectionEstablished(session("c", closed));
            assertThat(closed).containsExactly(RealtimeWebSocketHandler.SERVER_BUSY);
            // A slot frees up when a session closes.
            handler.afterConnectionClosed(session("a", new ArrayList<>()), CloseStatus.NORMAL);
            handler.afterConnectionEstablished(session("d", closed));
            assertThat(closed).hasSize(1);
        } finally {
            handler.destroy();
        }
    }
}
