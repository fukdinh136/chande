package com.chande.api_gateway.routing;

import org.springframework.http.server.PathContainer;
import org.springframework.web.util.pattern.PathPattern;
import org.springframework.web.util.pattern.PathPatternParser;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Kiểm tra lúc khởi động: không được có hai service cùng nhận một đường dẫn
 * (ví dụ {@code /trips/**} và {@code /trips/active}). Nếu cấu hình chồng lấn, một request có thể
 * đi nhầm service tuỳ thứ tự khai báo — dừng khởi động để phát hiện ngay thay vì định tuyến sai âm thầm.
 */
final class RouteConflictChecker {

    private record Entry(String serviceId, String raw, PathPattern pattern) {
    }

    private RouteConflictChecker() {
    }

    static void check(Map<String, RoutingProperties.Service> services) {
        PathPatternParser parser = PathPatternParser.defaultInstance;
        List<Entry> entries = new ArrayList<>();
        services.forEach((id, service) -> service.paths()
                .forEach(path -> entries.add(new Entry(id, path, parser.parse(path)))));

        for (int i = 0; i < entries.size(); i++) {
            for (int j = i + 1; j < entries.size(); j++) {
                Entry a = entries.get(i);
                Entry b = entries.get(j);
                if (!a.serviceId().equals(b.serviceId()) && overlaps(a, b)) {
                    throw new IllegalStateException("Route chồng lấn: " + a.serviceId() + " (" + a.raw() + ") và "
                            + b.serviceId() + " (" + b.raw() + ") cùng nhận một số đường dẫn");
                }
            }
        }
    }

    private static boolean overlaps(Entry a, Entry b) {
        return a.pattern().matches(PathContainer.parsePath(sample(b.raw())))
                || b.pattern().matches(PathContainer.parsePath(sample(a.raw())));
    }

    /** Một đường dẫn cụ thể khớp với mẫu: bỏ "/**" ở cuối, thay biến/wildcard bằng một segment bất kỳ. */
    static String sample(String pattern) {
        String path = pattern.endsWith("/**") ? pattern.substring(0, pattern.length() - 3) : pattern;
        path = path.replaceAll("\\{[^}]*}", "x").replace("**", "x").replace("*", "x");
        return path.isEmpty() ? "/" : path;
    }
}
