package com.chande.api_gateway.security;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.proc.JWSVerificationKeySelector;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.JWTParser;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimNames;
import org.springframework.security.oauth2.jwt.JwtClaimValidator;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.JwtIssuerValidator;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.JwtTypeValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;

import java.text.ParseException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;

/**
 * Xác thực JWT từ nhiều issuer (User Service cho khách, Driver Service cho tài xế).
 * Đọc {@code iss} (chưa tin) chỉ để chọn bộ kiểm tra đã cấu hình sẵn; chữ ký, hạn, role… được kiểm tra
 * bởi bộ kiểm tra của đúng issuer đó. Issuer lạ bị từ chối, không tải JWKS theo URL trong token.
 */
public final class IssuerRoutingJwtDecoder implements JwtDecoder {

    static final String ROLE_CLAIM = "role";
    private static final Set<JWSAlgorithm> ALGORITHMS = Set.of(JWSAlgorithm.RS256, JWSAlgorithm.ES256);

    private final Map<String, JwtDecoder> decoders;

    private IssuerRoutingJwtDecoder(Map<String, JwtDecoder> decoders) {
        this.decoders = Map.copyOf(decoders);
    }

    public static IssuerRoutingJwtDecoder create(JwtProperties properties,
                                                 Function<JwtProperties.Issuer, JWKSource<SecurityContext>> jwkSources) {
        Map<String, JwtDecoder> decoders = new HashMap<>();
        for (JwtProperties.Issuer issuer : properties.issuers()) {
            DefaultJWTProcessor<SecurityContext> processor = new DefaultJWTProcessor<>();
            processor.setJWSKeySelector(new JWSVerificationKeySelector<>(ALGORITHMS, jwkSources.apply(issuer)));
            // typ và claim do validator của Spring kiểm tra bên dưới
            processor.setJWSTypeVerifier((header, context) -> {
            });
            processor.setJWTClaimsSetVerifier((claims, context) -> {
            });
            NimbusJwtDecoder decoder = new NimbusJwtDecoder(processor);
            decoder.setJwtValidator(validator(issuer, properties));
            decoders.put(issuer.issuer(), decoder);
        }
        return new IssuerRoutingJwtDecoder(decoders);
    }

    @Override
    public Jwt decode(String token) throws JwtException {
        String issuer;
        try {
            JWTClaimsSet claims = JWTParser.parse(token).getJWTClaimsSet();
            issuer = claims == null ? null : claims.getIssuer();
        } catch (ParseException e) {
            throw new BadJwtException("Token không đúng định dạng JWT", e);
        }
        JwtDecoder decoder = issuer == null ? null : decoders.get(issuer);
        if (decoder == null) {
            throw new BadJwtException("Issuer không được tin cậy");
        }
        return decoder.decode(token);
    }

    private static OAuth2TokenValidator<Jwt> validator(JwtProperties.Issuer issuer, JwtProperties properties) {
        // User Service phát token "typ: at+jwt"; validator mặc định của Spring chỉ nhận "JWT"
        JwtTypeValidator type = new JwtTypeValidator(List.of("JWT", "at+jwt", "application/at+jwt"));
        type.setAllowEmpty(true);

        List<OAuth2TokenValidator<Jwt>> validators = new ArrayList<>(List.of(
                type,
                new JwtTimestampValidator(properties.clockSkew()),
                new JwtClaimValidator<>(JwtClaimNames.EXP, Objects::nonNull),
                new JwtIssuerValidator(issuer.issuer()),
                new JwtClaimValidator<>(JwtClaimNames.SUB, IssuerRoutingJwtDecoder::isUuid),
                new JwtClaimValidator<>(ROLE_CLAIM, role -> role instanceof String r && issuer.roles().contains(r))));
        if (!issuer.audiences().isEmpty()) {
            validators.add(new JwtClaimValidator<>(JwtClaimNames.AUD,
                    aud -> aud instanceof Collection<?> values && values.stream().anyMatch(issuer.audiences()::contains)));
        }
        return new DelegatingOAuth2TokenValidator<>(validators);
    }

    private static boolean isUuid(Object value) {
        if (!(value instanceof String s) || s.length() != 36) {
            return false;
        }
        try {
            UUID.fromString(s);
            return true;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }
}
