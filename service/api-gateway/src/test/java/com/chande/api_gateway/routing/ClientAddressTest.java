package com.chande.api_gateway.routing;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.servlet.function.ServerRequest;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ClientAddressTest {

    static ServerRequest spoofed() {
        var servlet = new MockHttpServletRequest("POST", "/driver-auth/otp/request");
        servlet.setRemoteAddr("203.0.113.9");
        servlet.addHeader("X-Driver-Client-IP", "198.51.100.1");
        servlet.addHeader("X-Driver-Proxy-Token", "guess");
        return ServerRequest.create(servlet, List.of());
    }

    @Test
    void setsGatewaySeenAddressAndConfiguredToken() {
        var config = new RoutingProperties.ClientAddress("X-Driver-Client-IP", "X-Driver-Proxy-Token", "server-token");
        var request = GatewayRoutesConfig.clientAddress(config).apply(spoofed());
        assertThat(request.headers().header("X-Driver-Client-IP")).containsExactly("203.0.113.9");
        assertThat(request.headers().header("X-Driver-Proxy-Token")).containsExactly("server-token");
        assertThat(config.toString()).doesNotContain("server-token");
    }

    @Test
    void withoutTokenOnlyRemovesClientSuppliedHeaders() {
        var config = new RoutingProperties.ClientAddress("X-Driver-Client-IP", "X-Driver-Proxy-Token", "");
        var request = GatewayRoutesConfig.clientAddress(config).apply(spoofed());
        assertThat(request.headers().header("X-Driver-Client-IP")).isEmpty();
        assertThat(request.headers().header("X-Driver-Proxy-Token")).isEmpty();
    }

    @Test
    void rejectsHalfConfiguredHeaders() {
        assertThatThrownBy(() -> new RoutingProperties.ClientAddress("X-Driver-Client-IP", "", ""))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new RoutingProperties.ClientAddress("", "", "token"))
                .isInstanceOf(IllegalStateException.class);
    }
}
