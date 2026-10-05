package com.chande.api_gateway.realtime;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.io.IOException;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Các kết nối WebSocket đang mở trên instance gateway này, theo người dùng.
 * Khoá là "ROLE:sub" (ví dụ "RIDER:3000…") vì khách và tài xế do hai issuer khác nhau phát hành.
 */
@Component
public class SessionRegistry {

    private static final Logger log = LoggerFactory.getLogger(SessionRegistry.class);

    private final Map<String, Set<WebSocketSession>> sessionsByUser = new ConcurrentHashMap<>();

    public static String userKey(String role, Object userId) {
        return role + ":" + userId;
    }

    /** @return false nếu người dùng đã đạt số kết nối tối đa */
    public boolean add(String userKey, WebSocketSession session, int maxSessionsPerUser) {
        boolean[] added = {false};
        sessionsByUser.compute(userKey, (key, sessions) -> {
            Set<WebSocketSession> set = sessions != null ? sessions : ConcurrentHashMap.newKeySet();
            if (set.size() < maxSessionsPerUser) {
                added[0] = set.add(session);
            }
            return set.isEmpty() ? null : set;
        });
        return added[0];
    }

    public void remove(String userKey, WebSocketSession session) {
        sessionsByUser.computeIfPresent(userKey, (key, sessions) -> {
            sessions.remove(session);
            return sessions.isEmpty() ? null : sessions;
        });
    }

    /** @return số kết nối đã gửi thành công */
    public int send(String userKey, String json) {
        Set<WebSocketSession> sessions = sessionsByUser.get(userKey);
        if (sessions == null) {
            return 0;
        }
        TextMessage message = new TextMessage(json);
        int sent = 0;
        for (WebSocketSession session : sessions) {
            try {
                if (session.isOpen()) {
                    session.sendMessage(message);
                    sent++;
                }
            } catch (IOException | IllegalStateException e) {
                // Kết nối chậm/đã đứt: decorator tự đóng session, afterConnectionClosed sẽ gỡ khỏi registry
                log.debug("Không gửi được tới {} ({}): {}", userKey, session.getId(), e.getMessage());
            }
        }
        return sent;
    }

    public int connectionCount() {
        return sessionsByUser.values().stream().mapToInt(Set::size).sum();
    }
}
