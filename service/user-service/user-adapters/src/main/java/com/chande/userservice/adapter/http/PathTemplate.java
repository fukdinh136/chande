package com.chande.userservice.adapter.http;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Mẫu path dạng {@code /users/me/addresses/{addressId}}; khớp chính xác từng segment (thừa "/" cuối là không khớp). */
final class PathTemplate {

    private final String template;
    private final List<String> segments;

    private PathTemplate(String template, List<String> segments) {
        this.template = template;
        this.segments = segments;
    }

    static PathTemplate parse(String template) {
        if (!template.startsWith("/")) {
            throw new IllegalArgumentException("Path template must start with '/': " + template);
        }
        return new PathTemplate(template, List.of(template.substring(1).split("/", -1)));
    }

    /**
     * Tách raw path thành các segment rồi mới decode từng segment, nên {@code %2F} không thành dấu phân cách.
     *
     * @return null nếu path không bắt đầu bằng "/"
     */
    static List<String> split(String rawPath) {
        if (rawPath == null || !rawPath.startsWith("/")) {
            return null;
        }
        List<String> result = new ArrayList<>();
        for (String segment : rawPath.substring(1).split("/", -1)) {
            result.add(decode(segment));
        }
        return result;
    }

    /** @return giá trị các tham số, hoặc null nếu không khớp */
    Map<String, String> match(List<String> path) {
        if (path.size() != segments.size()) {
            return null;
        }
        Map<String, String> params = new LinkedHashMap<>();
        for (int i = 0; i < segments.size(); i++) {
            String expected = segments.get(i);
            String actual = path.get(i);
            if (expected.startsWith("{") && expected.endsWith("}")) {
                if (actual.isEmpty()) {
                    return null;
                }
                params.put(expected.substring(1, expected.length() - 1), actual);
            } else if (!expected.equals(actual)) {
                return null;
            }
        }
        return params;
    }

    @Override
    public String toString() {
        return template;
    }

    /** Percent-decode (UTF-8). Chuỗi "%" không hợp lệ giữ nguyên dạng chữ. */
    private static String decode(String segment) {
        if (segment.indexOf('%') < 0) {
            return segment;
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        int i = 0;
        while (i < segment.length()) {
            if (segment.charAt(i) == '%' && i + 2 < segment.length()
                    && isHex(segment.charAt(i + 1)) && isHex(segment.charAt(i + 2))) {
                out.write(HexFormat.fromHexDigits(segment, i + 1, i + 3));
                i += 3;
            } else {
                int end = segment.indexOf('%', i + 1);
                end = end < 0 ? segment.length() : end;
                out.writeBytes(segment.substring(i, end).getBytes(StandardCharsets.UTF_8));
                i = end;
            }
        }
        return out.toString(StandardCharsets.UTF_8);
    }

    private static boolean isHex(char c) {
        return Character.digit(c, 16) >= 0;
    }
}
