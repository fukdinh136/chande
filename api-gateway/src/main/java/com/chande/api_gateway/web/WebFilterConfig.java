package com.chande.api_gateway.web;

import com.chande.api_gateway.routing.RoutingProperties;
import org.springframework.boot.security.autoconfigure.web.servlet.SecurityFilterProperties;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;

/**
 * Thứ tự filter: RequestId → InternalPort → Spring Security (xác thực, phân quyền, rate limit) → CachedBody.
 * Request bị từ chối ở Security không bị đọc body.
 */
@Configuration
public class WebFilterConfig {

    @Bean
    public FilterRegistrationBean<RequestIdFilter> requestIdFilter() {
        FilterRegistrationBean<RequestIdFilter> registration = new FilterRegistrationBean<>(new RequestIdFilter());
        registration.setOrder(Ordered.HIGHEST_PRECEDENCE);
        return registration;
    }

    @Bean
    public FilterRegistrationBean<CachedBodyFilter> cachedBodyFilter(RoutingProperties properties) {
        FilterRegistrationBean<CachedBodyFilter> registration =
                new FilterRegistrationBean<>(new CachedBodyFilter(properties.maxRequestBodySize()));
        registration.addUrlPatterns("/api/*", "/internal/*");
        registration.setOrder(SecurityFilterProperties.DEFAULT_FILTER_ORDER + 10);
        return registration;
    }
}
