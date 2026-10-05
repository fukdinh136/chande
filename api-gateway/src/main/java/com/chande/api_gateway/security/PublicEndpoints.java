package com.chande.api_gateway.security;

import org.springframework.http.HttpMethod;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.security.web.util.matcher.OrRequestMatcher;
import org.springframework.security.web.util.matcher.RequestMatcher;

import java.util.List;

/**
 * Endpoint không cần access token, theo tài liệu User Service (R01–R08) và Driver Service (D01–D04).
 * Dùng chung cho phân quyền, bỏ qua Bearer token cũ, và giới hạn số lần thử.
 */
public final class PublicEndpoints {

    /** Mọi endpoint ẩn danh (đều là POST). */
    public static final List<String> ANONYMOUS_POST = List.of(
            "/api/v1/auth/register",
            "/api/v1/auth/register/verify",
            "/api/v1/auth/otp/resend",
            "/api/v1/auth/login",
            "/api/v1/auth/refresh",
            "/api/v1/auth/logout",
            "/api/v1/auth/password/forgot",
            "/api/v1/auth/password/reset",
            "/api/v1/driver-auth/otp/request",
            "/api/v1/driver-auth/otp/verify",
            "/api/v1/driver-auth/refresh",
            "/api/v1/driver-auth/logout");

    /** Endpoint có thể bị dò mật khẩu/OTP hoặc spam SMS: giới hạn số lần thử theo IP ngay tại gateway. */
    public static final List<String> BRUTE_FORCE_SENSITIVE_POST = List.of(
            "/api/v1/auth/register",
            "/api/v1/auth/register/verify",
            "/api/v1/auth/otp/resend",
            "/api/v1/auth/login",
            "/api/v1/auth/password/forgot",
            "/api/v1/auth/password/reset",
            "/api/v1/driver-auth/otp/request",
            "/api/v1/driver-auth/otp/verify");

    // Cùng loại matcher với authorizeHttpRequests và route của gateway, nên cả ba hiểu đường dẫn
    // (kể cả dạng percent-encoding như "/auth/%6cogin") giống hệt nhau.
    public static final RequestMatcher ANONYMOUS = new OrRequestMatcher(ANONYMOUS_POST.stream()
            .map(path -> (RequestMatcher) PathPatternRequestMatcher.pathPattern(HttpMethod.POST, path))
            .toList());

    private PublicEndpoints() {
    }
}
