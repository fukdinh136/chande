package com.chande.api_gateway.routing;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.boot.context.properties.bind.ConstructorBinding;
import org.springframework.util.unit.DataSize;

import java.net.URI;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Bảng định tuyến: mỗi service khai báo các instance và các đường dẫn (sau {@code /api/v1}) mà nó phụ trách.
 * Thêm service mới chỉ cần thêm một khối trong {@code gateway.routing.services}.
 */
@ConfigurationProperties(prefix = "gateway.routing")
public record RoutingProperties(
        @DefaultValue("256KB") DataSize maxRequestBodySize,
        @DefaultValue("2s") Duration connectTimeout,
        @DefaultValue("15s") Duration readTimeout,
        @DefaultValue Failover failover,
        Map<String, Service> services) {

    public RoutingProperties {
        if (services == null || services.isEmpty()) {
            throw new IllegalStateException("Thiếu gateway.routing.services");
        }
        services = new LinkedHashMap<>(services);
    }

    /**
     * @param maxAttempts         số instance tối đa được thử cho một request khi không kết nối được
     * @param unavailableCooldown thời gian tạm bỏ qua một instance vừa không kết nối được
     */
    public record Failover(@DefaultValue("3") int maxAttempts,
                           @DefaultValue("10s") Duration unavailableCooldown) {

        public Failover {
            if (maxAttempts < 1) {
                throw new IllegalStateException("gateway.routing.failover.max-attempts phải >= 1");
            }
        }
    }

    /**
     * @param instances             URL gốc của từng instance, ví dụ {@code http://trip-1:3001}
     * @param paths                 các mẫu đường dẫn phía sau {@code /api/v1}, ví dụ {@code /trips/**}
     * @param maxConcurrentRequests số request đang chờ service này trả lời tối đa; vượt quá thì trả 503 ngay
     */
    public record Service(List<URI> instances,
                          List<String> paths,
                          @DefaultValue("256") int maxConcurrentRequests,
                          @DefaultValue("") String serviceToken) {

        public Service(List<URI> instances, List<String> paths, int maxConcurrentRequests) {
            this(instances, paths, maxConcurrentRequests, "");
        }

        @Override
        public String toString() {
            return "Service[instances=" + instances + ", paths=" + paths
                    + ", maxConcurrentRequests=" + maxConcurrentRequests + ", serviceToken=***]";
        }

        @ConstructorBinding
        public Service {
            if (instances == null || instances.isEmpty()) {
                throw new IllegalStateException("Mỗi service cần ít nhất một instance");
            }
            for (URI uri : instances) {
                boolean http = "http".equals(uri.getScheme()) || "https".equals(uri.getScheme());
                boolean bare = uri.getRawPath() == null || uri.getRawPath().isEmpty() || "/".equals(uri.getRawPath());
                if (!http || uri.getHost() == null || !bare || uri.getRawQuery() != null) {
                    throw new IllegalStateException(
                            "Instance phải có dạng http(s)://host:port, không kèm đường dẫn: " + uri);
                }
            }
            if (paths == null || paths.isEmpty()) {
                throw new IllegalStateException("Mỗi service cần ít nhất một path");
            }
            for (String path : paths) {
                if (!path.startsWith("/") || path.startsWith(ApiPaths.PREFIX + "/")) {
                    throw new IllegalStateException(
                            "Path phải bắt đầu bằng '/' và không gồm " + ApiPaths.PREFIX + ": " + path);
                }
                if (path.equals("/internal") || path.startsWith("/internal/")) {
                    throw new IllegalStateException("Không được public route nội bộ qua gateway: " + path);
                }
            }
            if (maxConcurrentRequests < 1) {
                throw new IllegalStateException("max-concurrent-requests phải >= 1");
            }
            instances = List.copyOf(instances);
            paths = List.copyOf(paths);
            serviceToken = serviceToken == null ? "" : serviceToken.trim();
            if (serviceToken.chars().anyMatch(c -> c <= 32 || c >= 127)) {
                throw new IllegalStateException("Service credential must be printable ASCII without whitespace");
            }
        }
    }
}
