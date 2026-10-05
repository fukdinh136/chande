package com.chande.api_gateway.error;

import com.chande.api_gateway.web.RequestIdFilter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * Ghi lỗi theo envelope chung của các service:
 * {@code {"error":{"code","message","details":[]},"meta":{"requestId"}}}.
 */
public final class ErrorResponseWriter {

    private ErrorResponseWriter() {
    }

    public static void write(HttpServletRequest request, HttpServletResponse response, ErrorCode code)
            throws IOException {
        write(request, response, code, List.of());
    }

    public static void write(HttpServletRequest request, HttpServletResponse response, ErrorCode code,
                             List<ErrorDetail> details) throws IOException {
        response.setStatus(code.getStatus().value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
        byte[] body = toJson(code, details, RequestIdFilter.requestId(request)).getBytes(StandardCharsets.UTF_8);
        response.setContentLength(body.length);
        // Proxy chép body bằng getOutputStream(); dùng cùng kiểu để vẫn ghi được lỗi khi đứt giữa chừng
        response.getOutputStream().write(body);
    }

    static String toJson(ErrorCode code, List<ErrorDetail> details, String requestId) {
        StringBuilder json = new StringBuilder(160)
                .append("{\"error\":{\"code\":\"").append(code.name())
                .append("\",\"message\":\"").append(escape(code.getMessage()))
                .append("\",\"details\":[");
        for (int i = 0; i < details.size(); i++) {
            ErrorDetail d = details.get(i);
            if (i > 0) json.append(',');
            json.append("{\"field\":\"").append(escape(d.field()))
                    .append("\",\"reason\":\"").append(escape(d.reason())).append("\"}");
        }
        return json.append("]},\"meta\":{\"requestId\":\"").append(escape(requestId)).append("\"}}")
                .toString();
    }

    private static String escape(String value) {
        StringBuilder out = new StringBuilder(value.length());
        for (char c : value.toCharArray()) {
            switch (c) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                default -> {
                    if (c < 0x20) out.append(String.format("\\u%04x", (int) c));
                    else out.append(c);
                }
            }
        }
        return out.toString();
    }
}
