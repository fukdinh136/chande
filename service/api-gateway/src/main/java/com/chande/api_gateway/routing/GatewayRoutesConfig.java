package com.chande.api_gateway.routing;

import com.chande.api_gateway.internal.ServiceTokenAuthenticationFilter;
import com.chande.api_gateway.web.RequestIdFilter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.web.servlet.function.RouterFunction;
import org.springframework.web.servlet.function.ServerRequest;
import org.springframework.web.servlet.function.ServerResponse;

import java.util.ArrayList;
import java.util.Map;
import java.util.function.BiFunction;

import static org.springframework.cloud.gateway.server.mvc.filter.BeforeFilterFunctions.removeRequestHeader;
import static org.springframework.cloud.gateway.server.mvc.filter.BeforeFilterFunctions.stripPrefix;
import static org.springframework.cloud.gateway.server.mvc.handler.GatewayRouterFunctions.route;
import static org.springframework.cloud.gateway.server.mvc.handler.HandlerFunctions.http;
import static org.springframework.cloud.gateway.server.mvc.predicate.GatewayRequestPredicates.path;

/**
 * Sinh route cho từng service từ {@link RoutingProperties}:
 * {@code /api/v1/<path>} → bỏ {@code /api/v1} → instance được {@link UpstreamFilter} chọn.
 */
@Configuration
public class GatewayRoutesConfig {

    private static final Logger log = LoggerFactory.getLogger(GatewayRoutesConfig.class);

    @Bean
    public RouterFunction<ServerResponse> serviceRoutes(RoutingProperties properties) {
        RouteConflictChecker.check(properties.services());

        RouterFunction<ServerResponse> routes = null;
        for (Map.Entry<String, RoutingProperties.Service> entry : properties.services().entrySet()) {
            RouterFunction<ServerResponse> route = serviceRoute(entry.getKey(), entry.getValue(), properties.failover());
            routes = routes == null ? route : routes.and(route);
            log.info("Route {}: {} -> {}", entry.getKey(),
                    entry.getValue().paths().stream().map(p -> ApiPaths.PREFIX + p).toList(),
                    entry.getValue().instances());
        }
        return routes;
    }

    private static RouterFunction<ServerResponse> serviceRoute(String serviceId, RoutingProperties.Service service,
                                                               RoutingProperties.Failover failover) {
        String[] patterns = service.paths().stream().map(p -> ApiPaths.PREFIX + p).toArray(String[]::new);
        ServiceInstanceSelector instances =
                new ServiceInstanceSelector(service.instances(), failover.unavailableCooldown());

        return route(serviceId)
                .route(path(patterns), http())
                .before(stripPrefix(ApiPaths.PREFIX_SEGMENTS))
                // Credential nội bộ không bao giờ được đi từ client xuống service
                .before(removeRequestHeader(ServiceTokenAuthenticationFilter.HEADER))
                .filter(new UpstreamFilter(serviceId, instances,
                        service.maxConcurrentRequests(), failover.maxAttempts()))
                .after(prefixRelativeLocation())
                .after(removeHeadersOwnedByGateway())
                .build();
    }

    /** Service trả {@code Location: /trips/<id>}; client cần đường dẫn public {@code /api/v1/trips/<id>}. */
    static BiFunction<ServerRequest, ServerResponse, ServerResponse> prefixRelativeLocation() {
        return (request, response) -> {
            String location = response.headers().getFirst(HttpHeaders.LOCATION);
            if (location != null && location.startsWith("/") && !location.startsWith("//")
                    && !location.startsWith(ApiPaths.PREFIX + "/")) {
                response.headers().set(HttpHeaders.LOCATION, ApiPaths.PREFIX + location);
            }
            return response;
        };
    }

    /**
     * Gateway tự đặt CORS và X-Request-Id; bỏ bản sao từ service để không bị trùng header
     * (trình duyệt từ chối response có hai Access-Control-Allow-Origin).
     */
    static BiFunction<ServerRequest, ServerResponse, ServerResponse> removeHeadersOwnedByGateway() {
        return (request, response) -> {
            HttpHeaders headers = response.headers();
            for (String name : new ArrayList<>(headers.headerNames())) {
                if (name.regionMatches(true, 0, "Access-Control-", 0, 15)
                        || name.equalsIgnoreCase(RequestIdFilter.HEADER)) {
                    headers.remove(name);
                }
            }
            return response;
        };
    }
}
