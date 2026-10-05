package com.chande.api_gateway.web;

import com.chande.api_gateway.error.ErrorCode;
import com.chande.api_gateway.error.ErrorResponseWriter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.util.unit.DataSize;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;

/**
 * Đọc trước body (JSON nhỏ) vào bộ nhớ với giới hạn kích thước:
 * <ul>
 *   <li>Chặn body quá lớn bằng 413 trước khi chiếm tài nguyên của service phía sau.</li>
 *   <li>Cho phép đọc lại body: khi instance đầu tiên không kết nối được, gateway gửi lại
 *       đúng body đó sang instance khác (xem {@code UpstreamFilter}).</li>
 * </ul>
 */
public class CachedBodyFilter extends OncePerRequestFilter {

    private final long maxBodyBytes;

    public CachedBodyFilter(DataSize maxBodySize) {
        this.maxBodyBytes = maxBodySize.toBytes();
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        long declaredLength = request.getContentLengthLong();
        boolean chunked = request.getHeader(HttpHeaders.TRANSFER_ENCODING) != null;
        if (declaredLength <= 0 && !chunked) {
            chain.doFilter(request, response);
            return;
        }
        if (declaredLength > maxBodyBytes) {
            ErrorResponseWriter.write(request, response, ErrorCode.PAYLOAD_TOO_LARGE);
            return;
        }
        byte[] body = readAtMost(request.getInputStream(), maxBodyBytes + 1);
        if (body.length > maxBodyBytes) {
            ErrorResponseWriter.write(request, response, ErrorCode.PAYLOAD_TOO_LARGE);
            return;
        }
        chain.doFilter(new CachedBodyRequest(request, body), response);
    }

    private static byte[] readAtMost(InputStream in, long limit) throws IOException {
        return in.readNBytes((int) Math.min(limit, Integer.MAX_VALUE - 8));
    }

    static final class CachedBodyRequest extends HttpServletRequestWrapper {

        private final byte[] body;

        CachedBodyRequest(HttpServletRequest request, byte[] body) {
            super(request);
            this.body = body;
        }

        /** Mỗi lần gọi trả về một stream mới từ đầu body, để có thể gửi lại khi failover. */
        @Override
        public ServletInputStream getInputStream() {
            return new ByteArrayServletInputStream(body);
        }

        @Override
        public BufferedReader getReader() {
            String encoding = getCharacterEncoding();
            Charset charset = encoding != null ? Charset.forName(encoding) : StandardCharsets.UTF_8;
            return new BufferedReader(new InputStreamReader(new ByteArrayInputStream(body), charset));
        }

        @Override
        public int getContentLength() {
            return body.length;
        }

        @Override
        public long getContentLengthLong() {
            return body.length;
        }
    }

    private static final class ByteArrayServletInputStream extends ServletInputStream {

        private final ByteArrayInputStream in;

        ByteArrayServletInputStream(byte[] body) {
            this.in = new ByteArrayInputStream(body);
        }

        @Override
        public int read() {
            return in.read();
        }

        @Override
        public int read(byte[] b, int off, int len) {
            return in.read(b, off, len);
        }

        @Override
        public boolean isFinished() {
            return in.available() == 0;
        }

        @Override
        public boolean isReady() {
            return true;
        }

        @Override
        public void setReadListener(ReadListener listener) {
            throw new UnsupportedOperationException("Gateway dùng I/O đồng bộ");
        }
    }
}
