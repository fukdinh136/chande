package com.chande.api_gateway.security;

import com.chande.api_gateway.error.ErrorCode;
import com.chande.api_gateway.error.ErrorResponseWriter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.stereotype.Component;

import java.io.IOException;

/** Lỗi xác thực của endpoint nội bộ: thiếu/sai X-Service-Token → 401, đúng token nhưng sai quyền → 403. */
@Component
public class InternalSecurityErrorHandler implements AuthenticationEntryPoint, AccessDeniedHandler {

    private static final Logger log = LoggerFactory.getLogger(InternalSecurityErrorHandler.class);

    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response,
                         AuthenticationException ex) throws IOException {
        log.warn("401 nội bộ {} {} từ {}", request.getMethod(), request.getRequestURI(), request.getRemoteAddr());
        ErrorResponseWriter.write(request, response, ErrorCode.INVALID_SERVICE_CREDENTIAL);
    }

    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response,
                       AccessDeniedException ex) throws IOException {
        log.warn("403 nội bộ {} {}", request.getMethod(), request.getRequestURI());
        ErrorResponseWriter.write(request, response, ErrorCode.FORBIDDEN_ACTION);
    }
}
