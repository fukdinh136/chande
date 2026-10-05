package com.chande.userservice.adapter.http;

import com.sun.net.httpserver.Headers;
import tools.jackson.core.JacksonException;

import java.io.IOException;
import java.io.InputStream;
import java.util.Map;
import java.util.UUID;

/**
 * Request đã qua khớp route, xác thực và parse path param. Body chỉ được đọc khi handler gọi {@link #json(Class)},
 * nên thứ tự lỗi đúng mục 2.2: path param (400) -> Content-Type (415) -> kích thước (413) -> JSON (400).
 */
public final class HttpRequest {

    private final String method;
    private final Map<String, UUID> pathParams;
    private final Headers headers;
    private final InputStream body;
    private final int maxBodyBytes;
    private final UUID userId;

    HttpRequest(String method, Map<String, UUID> pathParams, Headers headers, InputStream body, int maxBodyBytes,
                UUID userId) {
        this.method = method;
        this.pathParams = Map.copyOf(pathParams);
        this.headers = headers;
        this.body = body;
        this.maxBodyBytes = maxBodyBytes;
        this.userId = userId;
    }

    public String method() {
        return method;
    }

    public Headers headers() {
        return headers;
    }

    /** {@code sub} của access JWT; chỉ có ở route RIDER. */
    public UUID userId() {
        if (userId == null) {
            throw new IllegalStateException("Route is not authenticated as RIDER");
        }
        return userId;
    }

    /** Path param đã được Router kiểm là UUID chuẩn. */
    public UUID pathUuid(String name) {
        UUID value = pathParams.get(name);
        if (value == null) {
            throw new IllegalStateException("No path parameter '" + name + "'");
        }
        return value;
    }

    /**
     * Kiểm {@code Content-Type: application/json} (cho phép tham số như charset), đọc body có giới hạn rồi parse.
     * Body rỗng, {@code null}, JSON hỏng hoặc sai kiểu đều là 400 VALIDATION_ERROR không kèm fieldErrors.
     */
    public <T> T json(Class<T> type) {
        requireJsonContentType();
        byte[] bytes = readBody();
        if (bytes.length == 0) {
            throw HttpError.invalidBody();
        }
        T value;
        try {
            value = Json.read(bytes, type);
        } catch (JacksonException e) {
            throw HttpError.invalidBody();
        }
        if (value == null) {
            throw HttpError.invalidBody();
        }
        return value;
    }

    private void requireJsonContentType() {
        String contentType = headers.getFirst("Content-Type");
        if (contentType == null) {
            throw HttpError.unsupportedMediaType();
        }
        int semicolon = contentType.indexOf(';');
        String mediaType = (semicolon >= 0 ? contentType.substring(0, semicolon) : contentType).trim();
        if (!mediaType.equalsIgnoreCase("application/json")) {
            throw HttpError.unsupportedMediaType();
        }
    }

    private byte[] readBody() {
        try {
            byte[] bytes = body.readNBytes(maxBodyBytes + 1);
            if (bytes.length > maxBodyBytes) {
                throw HttpError.payloadTooLarge();
            }
            return bytes;
        } catch (IOException e) {
            throw HttpError.invalidBody(); // client gửi thiếu body hoặc đứt kết nối giữa chừng
        }
    }
}
