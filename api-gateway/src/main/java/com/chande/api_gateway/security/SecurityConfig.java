package com.chande.api_gateway.security;

import com.chande.api_gateway.ratelimit.LoginRateLimitFilter;
import com.chande.api_gateway.ratelimit.SlidingWindowRateLimiter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
public class SecurityConfig {

    private static final String RIDER = "RIDER";

    private final JwtAuthenticationConverter jwtAuthenticationConverter;
    private final JsonSecurityErrorHandler securityErrorHandler;
    private final SlidingWindowRateLimiter loginRateLimiter;

    public SecurityConfig(JwtAuthenticationConverter jwtAuthenticationConverter,
                          JsonSecurityErrorHandler securityErrorHandler,
                          SlidingWindowRateLimiter loginRateLimiter) {
        this.jwtAuthenticationConverter = jwtAuthenticationConverter;
        this.securityErrorHandler = securityErrorHandler;
        this.loginRateLimiter = loginRateLimiter;
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http.csrf(csrf -> csrf.disable())
                .cors(Customizer.withDefaults())
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .httpBasic(basic -> basic.disable())
                .formLogin(form -> form.disable())
                .addFilterBefore(new LoginRateLimitFilter(loginRateLimiter),
                        BearerTokenAuthenticationFilter.class)
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/actuator/health", "/error").permitAll()
                        .requestMatchers(HttpMethod.POST,
                                "/api/v1/users/auth/register",
                                "/api/v1/users/auth/login",
                                "/api/v1/users/auth/refresh").permitAll()
                        .requestMatchers("/internal/**").denyAll()
                        .requestMatchers("/api/v1/users/**").hasRole(RIDER)
                        .anyRequest().denyAll())
                .exceptionHandling(e -> e
                        .authenticationEntryPoint(securityErrorHandler)
                        .accessDeniedHandler(securityErrorHandler))
                .oauth2ResourceServer(oauth2 -> oauth2
                        .authenticationEntryPoint(securityErrorHandler)
                        .accessDeniedHandler(securityErrorHandler)
                        .jwt(jwt -> jwt.jwtAuthenticationConverter(jwtAuthenticationConverter)));
        return http.build();
    }
}