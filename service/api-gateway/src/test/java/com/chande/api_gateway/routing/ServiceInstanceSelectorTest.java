package com.chande.api_gateway.routing;

import org.junit.jupiter.api.Test;

import java.net.URI;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;

class ServiceInstanceSelectorTest {

    private static final URI A = URI.create("http://a:3001");
    private static final URI B = URI.create("http://b:3001");
    private static final URI C = URI.create("http://c:3001");

    private final AtomicLong now = new AtomicLong(0);
    private final ServiceInstanceSelector selector =
            new ServiceInstanceSelector(List.of(A, B, C), Duration.ofSeconds(10), now::get);

    private List<URI> pick(int times) {
        List<URI> picked = new ArrayList<>();
        for (int i = 0; i < times; i++) {
            picked.add(selector.choose(Set.of()));
        }
        return picked;
    }

    @Test
    void roundRobinsAcrossInstances() {
        assertThat(pick(6)).containsExactly(A, B, C, A, B, C);
    }

    @Test
    void skipsUnavailableInstanceDuringCooldown() {
        selector.markUnavailable(B);
        assertThat(pick(6)).doesNotContain(B).hasSize(6);
    }

    @Test
    void retriesInstanceAfterCooldown() {
        selector.markUnavailable(B);
        now.addAndGet(Duration.ofSeconds(11).toNanos());
        assertThat(pick(3)).contains(B);
    }

    @Test
    void successClearsUnavailableMark() {
        selector.markUnavailable(B);
        selector.markAvailable(B);
        assertThat(pick(3)).contains(B);
    }

    @Test
    void stillTriesSomethingWhenAllInstancesAreMarkedUnavailable() {
        selector.markUnavailable(A);
        selector.markUnavailable(B);
        selector.markUnavailable(C);
        assertThat(selector.choose(Set.of())).isNotNull();
    }

    @Test
    void neverReturnsAnInstanceAlreadyTriedForThisRequest() {
        assertThat(selector.choose(Set.of(A, B))).isEqualTo(C);
        assertThat(selector.choose(Set.of(A, B, C))).isNull();
    }
}
