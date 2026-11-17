package com.chande.api_gateway.realtime;

import com.chande.api_gateway.security.CorsProperties;
import org.springframework.boot.tomcat.servlet.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.context.annotation.Bean;
import jakarta.servlet.Filter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;

import java.util.Collections;
import java.util.Enumeration;

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
     * Turns down every WebSocket extension a client offers on /ws, in practice permessage-deflate (Node's WebSocket
     * and OkHttp on Android offer it by default). Each compressed session holds its own zlib Deflater and Inflater
     * in native memory, outside the heap and outside -XX:MaxRAMPercentage, while app messages are under 1 KB and
     * gain almost nothing from compression. Measured 2026-11-17: a wave of ~2900 reconnects grew native memory by
     * ~230 MB the JVM did not track and the 768 MiB pod was OOM-killed. See docs/bao-cao-kiem-thu-tai.md section 15.6.
     * <p>
     * Done by hiding the request header: Tomcat negotiates extensions itself during the upgrade and treats an empty
     * list from Spring's handshake handler as "every installed extension", so filtering there has no effect.
     */
    @Bean
    public FilterRegistrationBean<Filter> noWebSocketExtensions() {
        FilterRegistrationBean<Filter> registration = new FilterRegistrationBean<>(
                (request, response, chain) -> chain.doFilter(withoutExtensionOffer((HttpServletRequest) request), response));
        registration.addUrlPatterns("/ws");
        registration.setOrder(Ordered.HIGHEST_PRECEDENCE);
        return registration;
    }

    static HttpServletRequest withoutExtensionOffer(HttpServletRequest request) {
        return new HttpServletRequestWrapper(request) {
            @Override
            public String getHeader(String name) {
                return EXTENSIONS_HEADER.equalsIgnoreCase(name) ? null : super.getHeader(name);
            }

            @Override
            public Enumeration<String> getHeaders(String name) {
                return EXTENSIONS_HEADER.equalsIgnoreCase(name) ? Collections.emptyEnumeration() : super.getHeaders(name);
            }

            @Override
            public Enumeration<String> getHeaderNames() {
                return Collections.enumeration(Collections.list(super.getHeaderNames()).stream()
                        .filter(header -> !EXTENSIONS_HEADER.equalsIgnoreCase(header)).toList());
            }
        };
    }

    private static final String EXTENSIONS_HEADER = "Sec-WebSocket-Extensions";

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
