package com.chande.userservice.adapter.http;

import com.chande.userservice.domain.common.ValidationException;
import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;

import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Một {@link HttpHandler} cho toàn bộ service. Thứ tự xử lý (mục 2.2):
 * khớp route (404/405) -> xác thực (401/403) -> path param UUID (400) -> handler (Content-Type, body, validation,
 * use case). Mọi exception đi qua {@link ErrorMapper}.
 */
public final class Router implements HttpHandler {

    private static final Logger log = LoggerFactory.getLogger(Router.class);
    private static final Logger accessLog = LoggerFactory.getLogger("http.access");

    private static final Pattern CANONICAL_UUID =
            Pattern.compile("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");
    private static final Pattern UNSAFE_REQUEST_ID = Pattern.compile("[^A-Za-z0-9._:\\-]");
    private static final String NO_STORE = "no-cache, no-store, max-age=0, must-revalidate";

    private final List<Route> routes = new ArrayList<>();
    private final BearerAuthenticator bearer;
    private final InternalKeyAuthenticator internalKey;
    private final int maxBodyBytes;

    public Router(BearerAuthenticator bearer, InternalKeyAuthenticator internalKey, int maxBodyBytes) {
        this.bearer = bearer;
        this.internalKey = internalKey;
        this.maxBodyBytes = maxBodyBytes;
    }

    public Router get(String path, Access access, Handler handler) {
        return add("GET", path, access, handler);
    }

    public Router post(String path, Access access, Handler handler) {
        return add("POST", path, access, handler);
    }

    public Router put(String path, Access access, Handler handler) {
        return add("PUT", path, access, handler);
    }

    public Router patch(String path, Access access, Handler handler) {
        return add("PATCH", path, access, handler);
    }

    public Router delete(String path, Access access, Handler handler) {
        return add("DELETE", path, access, handler);
    }

    private Router add(String method, String path, Access access, Handler handler) {
        routes.add(new Route(method, PathTemplate.parse(path), access, handler));
        return this;
    }

    @Override
    public void handle(HttpExchange exchange) {
        long start = System.nanoTime();
        String requestId = exchange.getRequestHeaders().getFirst("X-Request-Id");
        if (requestId != null) {
            MDC.put("requestId", sanitizeRequestId(requestId));
        }
        try {
            HttpResult result;
            try {
                result = dispatch(exchange);
            } catch (Throwable error) {
                result = ErrorMapper.toResult(error);
            }
            byte[] body;
            try {
                body = result.body() == null ? null : Json.write(result.body());
            } catch (RuntimeException error) {
                result = ErrorMapper.toResult(error);
                body = Json.write(result.body());
            }
            send(exchange, result, body);
            logAccess(exchange, result, start);
        } catch (IOException e) {
            log.debug("Could not write response: {}", e.getMessage());
        } finally {
            exchange.close();
            MDC.remove("requestId");
        }
    }

    private HttpResult dispatch(HttpExchange exchange) throws Exception {
        String method = exchange.getRequestMethod();
        List<String> path = PathTemplate.split(exchange.getRequestURI().getRawPath());
        if (path == null) {
            throw HttpError.endpointNotFound();
        }

        Route matched = null;
        Map<String, String> params = null;
        Set<String> allowed = new LinkedHashSet<>();
        for (Route route : routes) {
            Map<String, String> candidate = route.path().match(path);
            if (candidate == null) {
                continue;
            }
            allowed.add(route.method());
            if (matched == null && route.method().equals(method)) {
                matched = route;
                params = candidate;
            }
        }
        if (allowed.isEmpty()) {
            throw HttpError.endpointNotFound();
        }
        if (matched == null) {
            throw HttpError.methodNotAllowed(allowed);
        }

        Headers headers = exchange.getRequestHeaders();
        UUID userId = switch (matched.access()) {
            case PUBLIC -> null;
            case RIDER -> bearer.authenticate(headers);
            case INTERNAL -> {
                internalKey.authenticate(headers);
                yield null;
            }
        };
        HttpRequest request = new HttpRequest(method, parseUuids(params), headers, exchange.getRequestBody(),
                maxBodyBytes, userId);
        return matched.handler().handle(request);
    }

    /** Mọi path param của service đều là UUID dạng chuẩn 36 ký tự. */
    private static Map<String, UUID> parseUuids(Map<String, String> params) {
        Map<String, UUID> result = new LinkedHashMap<>();
        Map<String, String> errors = new LinkedHashMap<>();
        params.forEach((name, value) -> {
            if (CANONICAL_UUID.matcher(value).matches()) {
                result.put(name, UUID.fromString(value));
            } else {
                errors.put(name, "Giá trị không hợp lệ");
            }
        });
        if (!errors.isEmpty()) {
            throw new ValidationException(errors);
        }
        return result;
    }

    /**
     * Header bảo mật trên mọi response (v1 có nhờ Spring Security). Bộ no-store chỉ đặt khi handler không tự chỉ
     * định Cache-Control (JWKS). Không đặt CORS và X-Request-Id: gateway tự lo.
     */
    private static void send(HttpExchange exchange, HttpResult result, byte[] body) throws IOException {
        Headers headers = exchange.getResponseHeaders();
        if (!result.headers().containsKey("Cache-Control")) {
            headers.set("Cache-Control", NO_STORE);
            headers.set("Pragma", "no-cache");
            headers.set("Expires", "0");
        }
        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("X-Frame-Options", "DENY");
        result.headers().forEach(headers::set);

        if (body == null || "HEAD".equals(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(result.status(), -1); // -1 = không có body (0 nghĩa là chunked)
            return;
        }
        headers.set("Content-Type", "application/json");
        exchange.sendResponseHeaders(result.status(), body.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(body);
        }
    }

    private static void logAccess(HttpExchange exchange, HttpResult result, long startNanos) {
        long millis = (System.nanoTime() - startNanos) / 1_000_000;
        String code = result.body() instanceof ErrorJson error ? " " + error.code() : "";
        accessLog.info("{} {} -> {}{} ({} ms)", exchange.getRequestMethod(), exchange.getRequestURI().getRawPath(),
                result.status(), code, millis);
    }

    /** Chống chèn ký tự điều khiển vào log. */
    private static String sanitizeRequestId(String value) {
        String cleaned = UNSAFE_REQUEST_ID.matcher(value).replaceAll("");
        return cleaned.length() > 128 ? cleaned.substring(0, 128) : cleaned;
    }
}
