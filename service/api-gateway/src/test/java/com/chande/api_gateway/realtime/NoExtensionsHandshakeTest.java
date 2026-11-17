package com.chande.api_gateway.realtime;

import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import java.util.Collections;

import static org.assertj.core.api.Assertions.assertThat;

/** /ws turns down permessage-deflate: per-session zlib state lives in native memory the heap limit does not cover. */
class NoExtensionsHandshakeTest {

    @Test
    void hidesTheCompressionOfferAndKeepsOtherHeaders() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/ws");
        request.addHeader("Sec-WebSocket-Extensions", "permessage-deflate; client_max_window_bits");
        request.addHeader("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==");

        HttpServletRequest seen = WebSocketConfig.withoutExtensionOffer(request);

        assertThat(seen.getHeader("sec-websocket-extensions")).isNull();
        assertThat(Collections.list(seen.getHeaders("Sec-WebSocket-Extensions"))).isEmpty();
        assertThat(Collections.list(seen.getHeaderNames())).doesNotContain("Sec-WebSocket-Extensions")
                .contains("Sec-WebSocket-Key");
        assertThat(seen.getHeader("Sec-WebSocket-Key")).isEqualTo("dGhlIHNhbXBsZSBub25jZQ==");
    }
}
