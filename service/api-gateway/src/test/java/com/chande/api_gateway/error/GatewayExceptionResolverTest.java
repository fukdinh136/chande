package com.chande.api_gateway.error;

import org.junit.jupiter.api.Test;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.servlet.NoHandlerFoundException;

import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.net.http.HttpConnectTimeoutException;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class GatewayExceptionResolverTest {

    private final GatewayExceptionResolver resolver = new GatewayExceptionResolver();

    private MockHttpServletResponse resolve(Exception ex) {
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
        assertThat(res.getContentAsString()).contains("\"code\":\"DEPENDENCY_UNAVAILABLE\"");
    }

    @Test
    void connectTimeoutIsAConnectFailureNotAGatewayTimeout() {
        ResourceAccessException ex = new ResourceAccessException("x", new HttpConnectTimeoutException("connect timed out"));
        assertThat(GatewayExceptionResolver.isConnectFailure(ex)).isTrue();
        assertThat(resolve(ex).getStatus()).isEqualTo(503);
    }

    @Test
    void readTimeoutBecomes504AndIsNotRetryable() throws Exception {
        ResourceAccessException ex = new ResourceAccessException("I/O error", new SocketTimeoutException("Read timed out"));
        MockHttpServletResponse res = resolve(ex);
        assertThat(res.getStatus()).isEqualTo(504);
        assertThat(res.getContentAsString()).contains("\"code\":\"GATEWAY_TIMEOUT\"");
        assertThat(GatewayExceptionResolver.isConnectFailure(ex)).isFalse();
    }

    @Test
    void noRouteBecomes404() throws Exception {
        MockHttpServletResponse res = resolve(new NoHandlerFoundException("GET", "/abc", new HttpHeaders()));
        assertThat(res.getStatus()).isEqualTo(404);
        assertThat(res.getContentAsString()).contains("\"code\":\"ENDPOINT_NOT_FOUND\"");
    }

    @Test
    void redisFailureBecomes503() {
        assertThat(resolve(new QueryTimeoutException("redis timeout")).getStatus()).isEqualTo(503);
    }

    @Test
    void gatewayExceptionKeepsDetailsAndRetryAfter() throws Exception {
        MockHttpServletResponse busy = resolve(new GatewayException(ErrorCode.DEPENDENCY_UNAVAILABLE, 1));
        assertThat(busy.getHeader("Retry-After")).isEqualTo("1");

        MockHttpServletResponse invalid = resolve(new GatewayException(ErrorCode.INVALID_REQUEST,
                List.of(new ErrorDetail("tripVersion", "phải là số nguyên >= 1"))));
        assertThat(invalid.getStatus()).isEqualTo(400);
        assertThat(invalid.getContentAsString())
                .contains("\"details\":[{\"field\":\"tripVersion\",\"reason\":\"phải là số nguyên >= 1\"}]");
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
    void usesSharedEnvelopeWithUtf8Message() throws Exception {
        MockHttpServletResponse res = resolve(new ResourceAccessException("x", new ConnectException("refused")));
        assertThat(res.getCharacterEncoding()).isEqualToIgnoringCase("UTF-8");
        assertThat(res.getHeader("Cache-Control")).isEqualTo("no-store");
        assertThat(res.getContentAsString())
                .startsWith("{\"error\":{\"code\":\"DEPENDENCY_UNAVAILABLE\",\"message\":\"Dịch vụ tạm thời không khả dụng")
                .contains("\"details\":[]")
                .contains("\"meta\":{\"requestId\":\"");
    }
}
