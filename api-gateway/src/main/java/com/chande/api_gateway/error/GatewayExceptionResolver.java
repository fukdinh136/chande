package com.chande.api_gateway.error;

import com.chande.api_gateway.web.RequestIdFilter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.stereotype.Component;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.servlet.HandlerExceptionResolver;
import org.springframework.web.servlet.ModelAndView;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.io.IOException;
import java.net.ConnectException;
import java.net.NoRouteToHostException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.net.http.HttpConnectTimeoutException;
import java.net.http.HttpTimeoutException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

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
            resetKeepingGatewayHeaders(response);
            if (ex instanceof GatewayException ge) {
                if (ge.getRetryAfterSeconds() > 0) {
                    response.setHeader(HttpHeaders.RETRY_AFTER, String.valueOf(ge.getRetryAfterSeconds()));
                }
                ErrorResponseWriter.write(request, response, code, ge.getDetails());
            } else {
                ErrorResponseWriter.write(request, response, code);
            }
        } catch (IOException ioEx) {
            log.warn("Không ghi được response lỗi", ioEx);
            return null;
        }
        return new ModelAndView();
    }

    static ErrorCode classify(Exception ex) {
        if (ex instanceof GatewayException ge) {
            return ge.getCode();
        }
        if (ex instanceof NoResourceFoundException || ex instanceof NoHandlerFoundException
                || ex instanceof HttpRequestMethodNotSupportedException) {
            return ErrorCode.ENDPOINT_NOT_FOUND;
        }
        if (ex instanceof HttpMessageNotReadableException || ex instanceof HttpMediaTypeNotSupportedException) {
            return ErrorCode.INVALID_REQUEST;
        }
        if (ex instanceof DataAccessException) {
            // Redis lỗi: bên gửi event (Trip) sẽ retry cùng eventId
            return ErrorCode.DEPENDENCY_UNAVAILABLE;
        }
        if (isConnectFailure(ex)) {
            return ErrorCode.DEPENDENCY_UNAVAILABLE;
        }
        for (Throwable t = ex; t != null; t = t.getCause()) {
            if (t instanceof SocketTimeoutException || t instanceof HttpTimeoutException) {
                return ErrorCode.GATEWAY_TIMEOUT;
            }
        }
        for (Throwable t = ex; t != null; t = t.getCause()) {
            if (t instanceof IOException) {
                // Kết nối tới service đứt giữa chừng, hoặc hết read-timeout khi đang đọc body phản hồi
                return ErrorCode.DEPENDENCY_UNAVAILABLE;
            }
        }
        return ErrorCode.INTERNAL_ERROR;
    }

    /**
     * Lỗi có thể xảy ra sau khi proxy đã chép status/header của service vào response (ví dụ đứt kết nối
     * khi đang đọc body). Xoá phần đó để client nhận một lỗi nhất quán, nhưng giữ header do gateway đặt.
     */
    private static void resetKeepingGatewayHeaders(HttpServletResponse response) {
        Map<String, List<String>> kept = new LinkedHashMap<>();
        for (String name : response.getHeaderNames()) {
            if (name.equalsIgnoreCase(RequestIdFilter.HEADER) || name.equalsIgnoreCase(HttpHeaders.VARY)
                    || name.regionMatches(true, 0, "Access-Control-", 0, 15)) {
                kept.putIfAbsent(name, new ArrayList<>(response.getHeaders(name)));
            }
        }
        response.reset();
        kept.forEach((name, values) -> values.forEach(value -> response.addHeader(name, value)));
    }

    /**
     * Lỗi xảy ra trước khi request được gửi tới service (không kết nối được, hết thời gian kết nối):
     * service chắc chắn chưa xử lý nên có thể gửi lại sang instance khác, kể cả với POST.
     * Ngược lại, timeout khi chờ phản hồi KHÔNG thuộc nhóm này vì service có thể đã xử lý xong.
     */
    public static boolean isConnectFailure(Throwable ex) {
        for (Throwable t = ex; t != null; t = t.getCause()) {
            if (t instanceof ConnectException
                    || t instanceof HttpConnectTimeoutException
                    || t instanceof UnknownHostException
                    || t instanceof NoRouteToHostException) {
                return true;
            }
        }
        return false;
    }

    private static Throwable rootCause(Throwable ex) {
        Throwable t = ex;
        while (t.getCause() != null && t.getCause() != t) {
            t = t.getCause();
        }
        return t;
    }
}
