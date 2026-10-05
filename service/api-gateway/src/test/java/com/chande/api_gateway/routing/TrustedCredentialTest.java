package com.chande.api_gateway.routing;

import java.net.URI;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.servlet.function.ServerRequest;
import static org.assertj.core.api.Assertions.assertThat;

class TrustedCredentialTest {
    @Test
    void serverCredentialOverridesUntrustedValueWithoutLeakingInConfig() {
        var servlet = new MockHttpServletRequest("POST", "/routes");
        servlet.addHeader("X-Service-Token", "client-spoof");
        var request = ServerRequest.create(servlet, List.of());
        var trusted = GatewayRoutesConfig.trustedCredential("server-only-token").apply(request);
        assertThat(trusted.headers().firstHeader("X-Service-Token")).isEqualTo("server-only-token");
        assertThat(new RoutingProperties.Service(List.of(URI.create("http://routing:3004")),
                List.of("/routes"), 2, "server-only-token").toString()).doesNotContain("server-only-token");
    }
}
