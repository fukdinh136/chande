package com.chande.api_gateway.error;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerExceptionResolver;
import org.springframework.web.servlet.ModelAndView;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.io.IOException;
import java.net.ConnectException;
import java.net.NoRouteToHostException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.net.http.HttpTimeoutException;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class GatewayExceptionResolver implements HandlerExceptionResolver {

    private static final Logger log = LoggerFactory.getLogger(GatewayExceptionResolver.class);

    @Override
    public ModelAndView resolveException(HttpServletRequest request, HttpServletResponse response,
                                         Object handler, Exception ex) {
        if (response.isCommitted()) {
            return null;
        }
        ErrorCode code = classify(ex);
        if (code == ErrorCode.INTERNAL_ERROR) {
            log.error("Lỗi không mong đợi: {} {}", request.getMethod(), request.getRequestURI(), ex);
        } else {
            log.warn("{} {} -> {} ({})", request.getMethod(), request.getRequestURI(), code, rootCause(ex));
        }
        try {
            ErrorResponseWriter.write(response, code);
        } catch (IOException ioEx) {
            log.warn("Không ghi được response lỗi", ioEx);
            return null;
        }
        return new ModelAndView();
    }

    static ErrorCode classify(Exception ex) {
        if (ex instanceof NoResourceFoundException || ex instanceof NoHandlerFoundException) {
            return ErrorCode.ENDPOINT_NOT_FOUND;
        }
        for (Throwable t = ex; t != null; t = t.getCause()) {
            if (t instanceof ConnectException
                    || t instanceof UnknownHostException
                    || t instanceof NoRouteToHostException) {
                return ErrorCode.SERVICE_UNAVAILABLE;
            }
            if (t instanceof SocketTimeoutException || t instanceof HttpTimeoutException) {
                return ErrorCode.GATEWAY_TIMEOUT;
            }
        }
        return ErrorCode.INTERNAL_ERROR;
    }

    private static Throwable rootCause(Throwable ex) {
        Throwable t = ex;
        while (t.getCause() != null && t.getCause() != t) {
            t = t.getCause();
        }
        return t;
    }
}