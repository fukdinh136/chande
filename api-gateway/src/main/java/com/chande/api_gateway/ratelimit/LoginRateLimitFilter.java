package com.chande.api_gateway.ratelimit;

import com.chande.api_gateway.error.ErrorCode;
import com.chande.api_gateway.error.ErrorResponseWriter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.security.web.util.matcher.RequestMatcher;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

public class LoginRateLimitFilter extends OncePerRequestFilter {

    static final String LOGIN_PATH = "/api/v1/users/auth/login";

    private static final Logger log = LoggerFactory.getLogger(LoginRateLimitFilter.class);

    private final SlidingWindowRateLimiter limiter;

    public LoginRateLimitFilter(SlidingWindowRateLimiter limiter) {
        this.limiter = limiter;
    }

    // Không so chuỗi getRequestURI(): đó là đường dẫn THÔ, "/auth/%6cogin" khác "/auth/login"
    // nhưng phân quyền và user-service lại giải mã thành "/auth/login" → lách được giới hạn.
    // Dùng cùng loại matcher với authorizeHttpRequests để hai bên luôn hiểu đường dẫn giống nhau.
    private static final RequestMatcher LOGIN_REQUEST =
            PathPatternRequestMatcher.pathPattern(HttpMethod.POST, LOGIN_PATH);

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !LOGIN_REQUEST.matches(request);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String clientIp = request.getRemoteAddr();
        long retryAfter = limiter.tryAcquire(clientIp);
        if (retryAfter > 0) {
            log.warn("Chặn đăng nhập từ {}: quá nhiều lần thử, chờ {} giây", clientIp, retryAfter);
            response.setHeader(HttpHeaders.RETRY_AFTER, String.valueOf(retryAfter));
            ErrorResponseWriter.write(response, ErrorCode.TOO_MANY_REQUESTS);
            return;
        }
        chain.doFilter(request, response);
    }
}