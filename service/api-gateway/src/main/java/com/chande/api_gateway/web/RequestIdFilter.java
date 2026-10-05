package com.chande.api_gateway.web;

import com.chande.api_gateway.error.ErrorCode;
import com.chande.api_gateway.error.ErrorDetail;
import com.chande.api_gateway.error.ErrorResponseWriter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Mỗi request có đúng một X-Request-Id dạng UUID (theo tài liệu của các service):
 * client gửi thì giữ nguyên, thiếu thì gateway sinh mới, sai định dạng thì trả 400.
 * Giá trị này được chuyển tiếp xuống service, trả lại cho client và ghi vào log (MDC).
 */
public class RequestIdFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Request-Id";
    static final String ATTRIBUTE = RequestIdFilter.class.getName() + ".requestId";
    private static final String MDC_KEY = "requestId";
    private static final Pattern UUID_PATTERN = Pattern.compile(
            "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");

    public static String requestId(HttpServletRequest request) {
        Object id = request.getAttribute(ATTRIBUTE);
        return id != null ? id.toString() : UUID.randomUUID().toString();
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        List<String> values = Collections.list(request.getHeaders(HEADER));
        String clientValue = values.isEmpty() ? null : values.getFirst();
        boolean valid = values.size() <= 1 && (clientValue == null || UUID_PATTERN.matcher(clientValue).matches());
        String requestId = valid && clientValue != null ? clientValue : UUID.randomUUID().toString();

        request.setAttribute(ATTRIBUTE, requestId);
        response.setHeader(HEADER, requestId);
        MDC.put(MDC_KEY, requestId);
        try {
            if (!valid) {
                ErrorResponseWriter.write(request, response, ErrorCode.INVALID_REQUEST,
                        List.of(new ErrorDetail(HEADER, "phải là một UUID")));
                return;
            }
            chain.doFilter(clientValue == null ? new WithRequestIdHeader(request, requestId) : request, response);
        } finally {
            MDC.remove(MDC_KEY);
        }
    }

    /** Thêm header X-Request-Id (do gateway sinh) để proxy chuyển tiếp xuống service. */
    private static final class WithRequestIdHeader extends HttpServletRequestWrapper {

        private final String requestId;

        WithRequestIdHeader(HttpServletRequest request, String requestId) {
            super(request);
            this.requestId = requestId;
        }

        @Override
        public String getHeader(String name) {
            return HEADER.equalsIgnoreCase(name) ? requestId : super.getHeader(name);
        }

        @Override
        public Enumeration<String> getHeaders(String name) {
            return HEADER.equalsIgnoreCase(name)
                    ? Collections.enumeration(List.of(requestId))
                    : super.getHeaders(name);
        }

        @Override
        public Enumeration<String> getHeaderNames() {
            List<String> names = new ArrayList<>(Collections.list(super.getHeaderNames()));
            names.add(HEADER);
            return Collections.enumeration(names);
        }
    }
}
