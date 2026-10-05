package com.chande.api_gateway.internal;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.context.SecurityContextHolderStrategy;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Xác định service gọi vào từ X-Service-Token. Danh tính lấy từ token đã cấu hình,
 * không tin header tự khai như "X-Caller". So sánh thời gian hằng để không lộ token qua thời gian phản hồi.
 */
public class ServiceTokenAuthenticationFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Service-Token";
    public static final String AUTHORITY_PREFIX = "SERVICE_";

    private final Map<String, byte[]> digestByCaller = new HashMap<>();
    private final SecurityContextHolderStrategy contextHolder = SecurityContextHolder.getContextHolderStrategy();

    public ServiceTokenAuthenticationFilter(Map<String, String> tokensByCaller) {
        tokensByCaller.forEach((caller, token) -> digestByCaller.put(caller, sha256(token)));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String token = request.getHeader(HEADER);
        String caller = token == null ? null : findCaller(sha256(token));
        if (caller != null) {
            SecurityContext context = contextHolder.createEmptyContext();
            context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(
                    caller, null, List.of(new SimpleGrantedAuthority(AUTHORITY_PREFIX + caller))));
            contextHolder.setContext(context);
        }
        chain.doFilter(request, response);
    }

    private String findCaller(byte[] digest) {
        String found = null;
        for (Map.Entry<String, byte[]> entry : digestByCaller.entrySet()) {
            if (MessageDigest.isEqual(entry.getValue(), digest)) {
                found = entry.getKey();
            }
        }
        return found;
    }

    private static byte[] sha256(String value) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
