package com.chande.api_gateway.realtime;

import com.chande.api_gateway.security.CorsProperties;
import org.springframework.boot.tomcat.servlet.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
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

    /**
     * Each open /ws session keeps Tomcat's socket read and write buffers for its whole life. At 8 KB each (the
     * default) they were a large part of the ~94 KB a session cost; app messages are well under 1 KB, so 4 KB is
     * plenty. Measured 2026-11-17 with 2500 riders online, see docs/bao-cao-kiem-thu-tai.md section 15.
     */
    @Bean
    public WebServerFactoryCustomizer<TomcatServletWebServerFactory> smallSocketBuffers() {
        return factory -> factory.addConnectorCustomizers(connector -> {
            connector.setProperty("socket.appReadBufSize", "4096");
            connector.setProperty("socket.appWriteBufSize", "4096");
        });
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
