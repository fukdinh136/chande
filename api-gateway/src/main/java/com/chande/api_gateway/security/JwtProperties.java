package com.chande.api_gateway.security;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

import java.net.URI;
import java.time.Duration;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Danh sách issuer được tin cậy. Theo tài liệu User/Trip: JWT ký RS256/ES256, khoá công khai lấy từ JWKS.
 * Mỗi issuer chỉ được phát hành các role khai báo ở đây (issuer của tài xế không thể phát token RIDER),
 * và URL JWKS lấy từ cấu hình, không bao giờ lấy từ nội dung token.
 *
 * @param clockSkew độ lệch đồng hồ cho phép khi kiểm tra exp (Trip: exp + 30 giây)
 */
@ConfigurationProperties(prefix = "jwt")
public record JwtProperties(@DefaultValue("30s") Duration clockSkew, List<Issuer> issuers) {

    public JwtProperties {
        if (issuers == null || issuers.isEmpty()) {
            throw new IllegalStateException("Thiếu jwt.issuers");
        }
        Set<String> seen = new HashSet<>();
        for (Issuer issuer : issuers) {
            if (!seen.add(issuer.issuer())) {
                throw new IllegalStateException("Issuer bị khai báo trùng: " + issuer.issuer());
            }
        }
        issuers = List.copyOf(issuers);
    }

    /**
     * @param issuer    giá trị claim {@code iss}, so khớp tuyệt đối
     * @param jwkSetUri nơi lấy khoá công khai, ví dụ {@code http://user-service:3011/.well-known/jwks.json}
     * @param roles     các giá trị claim {@code role} issuer này được phép phát hành
     * @param audiences nếu khai báo, token phải có ít nhất một audience trong danh sách; để trống thì
     *                  gateway không kiểm tra aud (service phía sau vẫn tự kiểm tra audience của mình)
     */
    public record Issuer(String issuer, URI jwkSetUri, Set<String> roles, @DefaultValue Set<String> audiences) {

        public Issuer {
            if (issuer == null || issuer.isBlank()) {
                throw new IllegalStateException("jwt.issuers[].issuer không được trống");
            }
            if (jwkSetUri == null || !("http".equals(jwkSetUri.getScheme()) || "https".equals(jwkSetUri.getScheme()))) {
                throw new IllegalStateException("jwt.issuers[].jwk-set-uri phải là URL http(s): " + issuer);
            }
            if (roles == null || roles.isEmpty()) {
                throw new IllegalStateException("jwt.issuers[].roles không được trống: " + issuer);
            }
            roles = Set.copyOf(roles);
            audiences = audiences == null ? Set.of() : Set.copyOf(audiences);
        }
    }
}
