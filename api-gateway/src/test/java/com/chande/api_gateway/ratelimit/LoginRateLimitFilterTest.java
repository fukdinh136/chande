package com.chande.api_gateway.ratelimit;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;

class LoginRateLimitFilterTest {

    // Giới hạn 1 lần/phút để test ngắn gọn: lần 1 qua, lần 2 bị 429
    private final LoginRateLimitFilter filter = new LoginRateLimitFilter(new SlidingWindowRateLimiter(
            1, Duration.ofMinutes(1), Clock.fixed(Instant.parse("2026-10-03T00:00:00Z"), ZoneOffset.UTC)));

    private MockHttpServletResponse send(String method, String uri) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest(method, uri);
        request.setRemoteAddr("1.1.1.1");
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(request, response, new MockFilterChain());
        return response;
    }

    @Test
    void blocksSecondLoginAttempt() throws Exception {
        assertThat(send("POST", "/api/v1/users/auth/login").getStatus()).isEqualTo(200);

        MockHttpServletResponse blocked = send("POST", "/api/v1/users/auth/login");
        assertThat(blocked.getStatus()).isEqualTo(429);
        assertThat(blocked.getHeader("Retry-After")).isEqualTo("60");
    }

    @Test
    void percentEncodedPathCountsAsLogin() throws Exception {
        // %6c = 'l': phân quyền và user-service giải mã thành /auth/login nên filter cũng phải đếm
        send("POST", "/api/v1/users/auth/login");
        assertThat(send("POST", "/api/v1/users/auth/%6cogin").getStatus()).isEqualTo(429);
    }

    @Test
    void otherRequestsAreNotLimited() throws Exception {
        send("POST", "/api/v1/users/auth/login");
        assertThat(send("GET", "/api/v1/users/auth/login").getStatus()).isEqualTo(200);
        assertThat(send("POST", "/api/v1/users/auth/register").getStatus()).isEqualTo(200);
    }
}
