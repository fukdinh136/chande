package com.chande.api_gateway.routing;

import org.junit.jupiter.api.Test;

import java.net.URI;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RouteConflictCheckerTest {

    private static RoutingProperties.Service service(String... paths) {
        return new RoutingProperties.Service(List.of(URI.create("http://localhost:3000")), List.of(paths), 10);
    }

    private static Map<String, RoutingProperties.Service> services(Object... idAndService) {
        Map<String, RoutingProperties.Service> map = new LinkedHashMap<>();
        for (int i = 0; i < idAndService.length; i += 2) {
            map.put((String) idAndService[i], (RoutingProperties.Service) idAndService[i + 1]);
        }
        return map;
    }

    @Test
    void documentedPrefixesDoNotOverlap() {
        assertThatCode(() -> RouteConflictChecker.check(services(
                "user-service", service("/auth/**", "/users/**"),
                "driver-service", service("/driver-auth/**", "/drivers/**"),
                "trip-service", service("/trips/**"),
                "routing-service", service("/routing/**"))))
                .doesNotThrowAnyException();
    }

    @Test
    void detectsTwoServicesClaimingTheSamePath() {
        assertThatThrownBy(() -> RouteConflictChecker.check(services(
                "trip-service", service("/trips/**"),
                "matching", service("/trips/active"))))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("trip-service")
                .hasMessageContaining("matching");
    }

    @Test
    void detectsOverlapThroughWildcardsAndVariables() {
        assertThatThrownBy(() -> RouteConflictChecker.check(services(
                "a", service("/trips/{id}/status"),
                "b", service("/trips/*/status"))))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void rejectsPublishingInternalOrPrefixedPaths() {
        assertThatThrownBy(() -> service("/internal/**")).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> service("/api/v1/trips/**")).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new RoutingProperties.Service(
                List.of(URI.create("http://localhost:3001/trips")), List.of("/trips/**"), 10))
                .isInstanceOf(IllegalStateException.class);
    }
}
