package com.chande.api_gateway.security;

import com.chande.api_gateway.internal.InternalApiProperties;
import com.chande.api_gateway.internal.ServiceTokenAuthenticationFilter;
import com.chande.api_gateway.ratelimit.AuthRateLimitFilter;
import com.chande.api_gateway.ratelimit.SlidingWindowRateLimiter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.web.BearerTokenResolver;
import org.springframework.security.oauth2.server.resource.web.DefaultBearerTokenResolver;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.intercept.AuthorizationFilter;

@Configuration
public class SecurityConfig {

    private static final String RIDER = "RIDER";
    private static final String DRIVER = "DRIVER";
    static final String TRIP_SERVICE_AUTHORITY = ServiceTokenAuthenticationFilter.AUTHORITY_PREFIX + "trip-service";

    /**
     * Endpoint nội bộ của gateway (Trip gửi sự kiện chuyến). Chỉ nhận X-Service-Token, không nhận JWT
     * người dùng; chỉ phục vụ trên cổng nội bộ (xem {@code InternalPortFilter}).
     */
    @Bean
    @Order(1)
    public SecurityFilterChain internalSecurityFilterChain(HttpSecurity http, InternalApiProperties properties,
                                                           InternalSecurityErrorHandler errorHandler) throws Exception {
        http.securityMatcher("/internal/**")
                .csrf(csrf -> csrf.disable())
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .httpBasic(basic -> basic.disable())
                .formLogin(form -> form.disable())
                .addFilterBefore(new ServiceTokenAuthenticationFilter(properties.callers()), AuthorizationFilter.class)
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(HttpMethod.POST, "/internal/events/trips").hasAuthority(TRIP_SERVICE_AUTHORITY)
                        .anyRequest().denyAll())
                .exceptionHandling(e -> e
                        .authenticationEntryPoint(errorHandler)
                        .accessDeniedHandler(errorHandler));
        return http.build();
    }

    /**
     * API public cho Customer App, Driver App và Web quản trị. Quyền theo tài liệu từng service;
     * request bị chặn ở đây không tốn tài nguyên của service phía sau.
     */
    @Bean
    @Order(2)
    public SecurityFilterChain apiSecurityFilterChain(HttpSecurity http,
                                                      JwtAuthenticationConverter jwtAuthenticationConverter,
                                                      JsonSecurityErrorHandler securityErrorHandler,
                                                      SlidingWindowRateLimiter authRateLimiter) throws Exception {
        http.csrf(csrf -> csrf.disable())
                .cors(Customizer.withDefaults())
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .httpBasic(basic -> basic.disable())
                .formLogin(form -> form.disable())
                .addFilterBefore(new AuthRateLimitFilter(authRateLimiter), BearerTokenAuthenticationFilter.class)
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/actuator/health", "/actuator/health/**", "/error").permitAll()
                        // WebSocket: xác thực bằng JWT trong handshake hoặc tin nhắn "auth" đầu tiên
                        .requestMatchers(HttpMethod.GET, "/ws").permitAll()
                        .requestMatchers(PublicEndpoints.ANONYMOUS).permitAll()

                        // Customer Service (tài liệu User Service)
                        .requestMatchers(HttpMethod.POST, "/api/v1/auth/logout-all").hasRole(RIDER)
                        .requestMatchers("/api/v1/users/**").hasRole(RIDER)

                        // Driver Service
                        .requestMatchers("/api/v1/drivers/**").hasRole(DRIVER)

                        // Trip Service: R01/R02 chỉ khách, R06 chỉ tài xế, còn lại cả hai
                        .requestMatchers(HttpMethod.POST, "/api/v1/trips/estimate", "/api/v1/trips").hasRole(RIDER)
                        .requestMatchers(HttpMethod.PATCH, "/api/v1/trips/*/status").hasRole(DRIVER)
                        .requestMatchers("/api/v1/trips/**").hasAnyRole(RIDER, DRIVER)

                        // Routing Gateway scope excludes estimate/matrix and all internal routes.
                        .requestMatchers(HttpMethod.POST, "/api/v1/routes/navigation").hasRole(DRIVER)
                        .requestMatchers(HttpMethod.POST, "/api/v1/routes", "/api/v1/routes/recalculate").hasAnyRole(RIDER, DRIVER)
                        .requestMatchers(HttpMethod.GET, "/api/v1/matching/offers/active", "/api/v1/matching/offers/*").hasRole(DRIVER)
                        .requestMatchers(HttpMethod.POST, "/api/v1/matching/offers/*/accept", "/api/v1/matching/offers/*/decline").hasRole(DRIVER)

                        .anyRequest().denyAll())
                .exceptionHandling(e -> e
                        .authenticationEntryPoint(securityErrorHandler)
                        .accessDeniedHandler(securityErrorHandler))
                .oauth2ResourceServer(oauth2 -> oauth2
                        .bearerTokenResolver(ignoringTokenOnPublicEndpoints())
                        .authenticationEntryPoint(securityErrorHandler)
                        .accessDeniedHandler(securityErrorHandler)
                        .jwt(jwt -> jwt.jwtAuthenticationConverter(jwtAuthenticationConverter)));
        return http.build();
    }

    /**
     * App thường gắn Authorization vào mọi request. Với /auth/refresh hay /auth/logout, access token lúc đó
     * thường đã hết hạn; nếu vẫn kiểm tra thì gateway trả 401 và người dùng không làm mới/đăng xuất được.
     * Vì vậy endpoint ẩn danh bỏ qua Bearer token (header vẫn được chuyển tiếp nguyên vẹn).
     */
    static BearerTokenResolver ignoringTokenOnPublicEndpoints() {
        DefaultBearerTokenResolver delegate = new DefaultBearerTokenResolver();
        return request -> PublicEndpoints.ANONYMOUS.matches(request) ? null : delegate.resolve(request);
    }
}
