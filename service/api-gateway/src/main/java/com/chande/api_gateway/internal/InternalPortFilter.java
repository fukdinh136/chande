package com.chande.api_gateway.internal;

import com.chande.api_gateway.error.ErrorCode;
import com.chande.api_gateway.error.ErrorResponseWriter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.security.web.util.matcher.OrRequestMatcher;
import org.springframework.security.web.util.matcher.RequestMatcher;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Tách hai cổng: {@code /internal/**} chỉ phục vụ trên cổng nội bộ, mọi API khác chỉ trên cổng public.
 * Như vậy dù cổng public bị lộ ra Internet, không ai gọi được endpoint nội bộ (và ngược lại).
 * Dùng matcher giống Spring MVC nên dạng percent-encoding như "/%69nternal/..." cũng bị chặn.
 */
public class InternalPortFilter extends OncePerRequestFilter {

    private static final RequestMatcher INTERNAL = PathPatternRequestMatcher.pathPattern("/internal/**");
    private static final RequestMatcher HEALTH = new OrRequestMatcher(
            PathPatternRequestMatcher.pathPattern("/actuator/health"),
            PathPatternRequestMatcher.pathPattern("/actuator/health/**"));

    private final int internalPort;

    public InternalPortFilter(int internalPort) {
        this.internalPort = internalPort;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        boolean onInternalPort = request.getLocalPort() == internalPort;
        if (onInternalPort != INTERNAL.matches(request) && !HEALTH.matches(request)) {
            ErrorResponseWriter.write(request, response, ErrorCode.ENDPOINT_NOT_FOUND);
            return;
        }
        chain.doFilter(request, response);
    }
}
