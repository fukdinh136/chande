package com.chande.api_gateway.realtime;

import com.chande.api_gateway.security.CorsProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final RealtimeWebSocketHandler handler;
    private final CorsProperties corsProperties;

    public WebSocketConfig(RealtimeWebSocketHandler handler, CorsProperties corsProperties) {
        this.handler = handler;
        this.corsProperties = corsProperties;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        // App mobile không gửi Origin nên luôn được nhận; trình duyệt chỉ được nhận từ origin trong danh sách CORS
        registry.addHandler(handler, "/ws")
                .setAllowedOrigins(corsProperties.allowedOrigins().toArray(String[]::new));
    }

    @Bean
    public ServletServerContainerFactoryBean createWebSocketContainer(RealtimeProperties properties) {
        ServletServerContainerFactoryBean container = new ServletServerContainerFactoryBean();
        container.setMaxTextMessageBufferSize((int) properties.maxMessageSize().toBytes());
        container.setMaxBinaryMessageBufferSize(1024);
        container.setMaxSessionIdleTimeout(properties.idleTimeout().toMillis());
        return container;
    }
}
