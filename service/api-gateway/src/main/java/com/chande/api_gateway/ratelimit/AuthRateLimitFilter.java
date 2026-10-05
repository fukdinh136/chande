package com.chande.api_gateway.ratelimit;

import com.chande.api_gateway.error.ErrorCode;
import com.chande.api_gateway.error.ErrorResponseWriter;
import com.chande.api_gateway.security.PublicEndpoints;
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
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Giới hạn số lần gọi các endpoint đăng nhập/OTP theo IP (mỗi endpoint một ngân sách riêng).
 * Đây là lớp chặn thô ở gateway; User/Driver Service vẫn tự giới hạn theo tài khoản như tài liệu.
 */
public class AuthRateLimitFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(AuthRateLimitFilter.class);

    // Không so chuỗi getRequestURI(): đó là đường dẫn THÔ, "/auth/%6cogin" khác "/auth/login"
    // nhưng phân quyền và service lại giải mã thành "/auth/login" → lách được giới hạn.
    // Dùng cùng loại matcher với authorizeHttpRequests để hai bên luôn hiểu đường dẫn giống nhau.
    private static final Map<String, RequestMatcher> LIMITED = PublicEndpoints.BRUTE_FORCE_SENSITIVE_POST.stream()
            .collect(Collectors.toUnmodifiableMap(path -> path,
                    path -> PathPatternRequestMatcher.pathPattern(HttpMethod.POST, path)));

    private final SlidingWindowRateLimiter limiter;

    public AuthRateLimitFilter(SlidingWindowRateLimiter limiter) {
        this.limiter = limiter;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !HttpMethod.POST.matches(request.getMethod()) || matchedEndpoint(request) == null;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String endpoint = matchedEndpoint(request);
        String clientIp = request.getRemoteAddr();
        long retryAfter = limiter.tryAcquire(endpoint + " " + clientIp);
        if (retryAfter > 0) {
            log.warn("Chặn {} từ {}: quá nhiều lần thử, chờ {} giây", endpoint, clientIp, retryAfter);
            response.setHeader(HttpHeaders.RETRY_AFTER, String.valueOf(retryAfter));
            ErrorResponseWriter.write(request, response, ErrorCode.RATE_LIMITED);
            return;
        }
        chain.doFilter(request, response);
    }

    private static String matchedEndpoint(HttpServletRequest request) {
        for (Map.Entry<String, RequestMatcher> entry : LIMITED.entrySet()) {
            if (entry.getValue().matches(request)) {
                return entry.getKey();
            }
        }
        return null;
    }
}
