package com.chande.api_gateway.error;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.servlet.NoHandlerFoundException;

import java.net.ConnectException;
import java.net.SocketTimeoutException;

import static org.assertj.core.api.Assertions.assertThat;

class GatewayExceptionResolverTest {

    private final GatewayExceptionResolver resolver = new GatewayExceptionResolver();

    private MockHttpServletResponse resolve(Exception ex) throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        resolver.resolveException(new MockHttpServletRequest("GET", "/api/v1/users/me"), response, null, ex);
        return response;
    }

    @Test
    void connectionRefusedBecomes503() throws Exception {
        MockHttpServletResponse res = resolve(new ResourceAccessException("I/O error",
                new ConnectException("Connection refused")));
        assertThat(res.getStatus()).isEqualTo(503);
        assertThat(res.getContentType()).startsWith("application/json");
        assertThat(res.getContentAsString()).contains("\"code\":\"SERVICE_UNAVAILABLE\"");
    }

    @Test
    void readTimeoutBecomes504() throws Exception {
        MockHttpServletResponse res = resolve(new ResourceAccessException("I/O error",
                new SocketTimeoutException("Read timed out")));
        assertThat(res.getStatus()).isEqualTo(504);
        assertThat(res.getContentAsString()).contains("\"code\":\"GATEWAY_TIMEOUT\"");
    }

    @Test
    void noRouteBecomes404() throws Exception {
        MockHttpServletResponse res = resolve(new NoHandlerFoundException("GET", "/abc", new HttpHeaders()));
        assertThat(res.getStatus()).isEqualTo(404);
        assertThat(res.getContentAsString()).contains("\"code\":\"ENDPOINT_NOT_FOUND\"");
    }

    @Test
    void unexpectedErrorBecomes500WithoutDetails() throws Exception {
        MockHttpServletResponse res = resolve(new IllegalStateException("bí mật nội bộ"));
        assertThat(res.getStatus()).isEqualTo(500);
        assertThat(res.getContentAsString())
                .contains("\"code\":\"INTERNAL_ERROR\"")
                .doesNotContain("bí mật nội bộ");
    }

    @Test
    void vietnameseMessageIsUtf8() throws Exception {
        MockHttpServletResponse res = resolve(new ResourceAccessException("x", new ConnectException("refused")));
        assertThat(res.getCharacterEncoding()).isEqualToIgnoringCase("UTF-8");
        assertThat(res.getContentAsString()).contains("Dịch vụ tạm thời không khả dụng");
    }
}