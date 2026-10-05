package com.chande.api_gateway.security;

import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.jwk.source.JWKSourceBuilder;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jose.util.DefaultResourceRetriever;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter;

import java.net.MalformedURLException;
import java.net.URI;
import java.time.Duration;

@Configuration
public class JwtConfig {

    private static final int JWKS_CONNECT_TIMEOUT_MS = 2_000;
    private static final int JWKS_READ_TIMEOUT_MS = 3_000;
    private static final int JWKS_SIZE_LIMIT_BYTES = 256 * 1024;

    @Bean
    public JwtDecoder jwtDecoder(JwtProperties properties) {
        return IssuerRoutingJwtDecoder.create(properties, issuer -> remoteJwkSource(issuer.jwkSetUri()));
    }

    /**
     * JWKS được cache 5 phút và chỉ tải lại tối đa mỗi 30 giây khi gặp kid lạ, nên dù nhiều request
     * mang token giả cũng không dội tải sang User/Driver Service. Nếu JWKS tạm không truy cập được,
     * vẫn dùng khoá đã cache thêm 30 phút để gateway không từ chối hàng loạt token hợp lệ.
     * Khoá được tải lần đầu khi có request cần xác thực, không phải lúc khởi động.
     */
    static JWKSource<SecurityContext> remoteJwkSource(URI jwkSetUri) {
        try {
            return JWKSourceBuilder
                    .create(jwkSetUri.toURL(), new DefaultResourceRetriever(
                            JWKS_CONNECT_TIMEOUT_MS, JWKS_READ_TIMEOUT_MS, JWKS_SIZE_LIMIT_BYTES))
                    .cache(Duration.ofMinutes(5).toMillis(), Duration.ofSeconds(5).toMillis())
                    .rateLimited(Duration.ofSeconds(30).toMillis())
                    .outageTolerant(Duration.ofMinutes(30).toMillis())
                    .build();
        } catch (MalformedURLException e) {
            throw new IllegalStateException("jwk-set-uri không hợp lệ: " + jwkSetUri, e);
        }
    }

    @Bean
    public JwtAuthenticationConverter jwtAuthenticationConverter() {
        JwtGrantedAuthoritiesConverter authorities = new JwtGrantedAuthoritiesConverter();
        authorities.setAuthoritiesClaimName(IssuerRoutingJwtDecoder.ROLE_CLAIM);
        authorities.setAuthorityPrefix("ROLE_");

        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(authorities);
        return converter;
    }
}
