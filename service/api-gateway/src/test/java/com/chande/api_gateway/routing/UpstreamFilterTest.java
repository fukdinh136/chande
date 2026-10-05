package com.chande.api_gateway.routing;

import com.chande.api_gateway.error.ErrorCode;
import com.chande.api_gateway.error.GatewayException;
import org.junit.jupiter.api.Test;
import org.springframework.cloud.gateway.server.mvc.common.MvcUtils;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.servlet.function.HandlerFunction;
import org.springframework.web.servlet.function.ServerRequest;
import org.springframework.web.servlet.function.ServerResponse;

import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class UpstreamFilterTest {

    private static final URI A = URI.create("http://a:3001");
    private static final URI B = URI.create("http://b:3001");

    private final List<URI> attempts = new CopyOnWriteArrayList<>();

    private static ServerRequest request() {
        return ServerRequest.create(new MockHttpServletRequest("POST", "/trips"), List.of());
    }

    private UpstreamFilter filter(int maxConcurrent, int maxAttempts) {
        return new UpstreamFilter("trip-service",
                new ServiceInstanceSelector(List.of(A, B), Duration.ofSeconds(10)), maxConcurrent, maxAttempts);
    }

    /** Handler giả: ghi lại instance được chọn, instance A từ chối kết nối. */
    private HandlerFunction<ServerResponse> refusingA() {
        return request -> {
            URI target = (URI) request.attribute(MvcUtils.GATEWAY_REQUEST_URL_ATTR).orElseThrow();
            attempts.add(target);
            if (target.equals(A)) {
                throw new ResourceAccessException("I/O error", new ConnectException("Connection refused"));
            }
            return ServerResponse.ok().build();
        };
    }

    @Test
    void retriesOnAnotherInstanceWhenConnectionIsRefused() throws Exception {
        UpstreamFilter filter = filter(10, 3);
        for (int i = 0; i < 4; i++) {
            assertThat(filter.filter(request(), refusingA()).statusCode().value()).isEqualTo(200);
        }
        // A bị từ chối một lần rồi bị tạm bỏ qua; mọi request đều thành công qua B
        assertThat(attempts).containsOnlyOnce(A);
        assertThat(attempts).filteredOn(B::equals).hasSize(4);
    }

    @Test
    void givesUpWhenEveryInstanceIsDown() {
        UpstreamFilter filter = filter(10, 3);
        HandlerFunction<ServerResponse> allDown = request -> {
            attempts.add((URI) request.attribute(MvcUtils.GATEWAY_REQUEST_URL_ATTR).orElseThrow());
            throw new ResourceAccessException("I/O error", new ConnectException("Connection refused"));
        };
        assertThatThrownBy(() -> filter.filter(request(), allDown)).isInstanceOf(ResourceAccessException.class);
        assertThat(attempts).containsExactlyInAnyOrder(A, B);
    }

    @Test
    void doesNotRetryWhenServiceMayHaveProcessedTheRequest() {
        UpstreamFilter filter = filter(10, 3);
        HandlerFunction<ServerResponse> timeout = request -> {
            attempts.add((URI) request.attribute(MvcUtils.GATEWAY_REQUEST_URL_ATTR).orElseThrow());
            throw new ResourceAccessException("I/O error", new SocketTimeoutException("Read timed out"));
        };
        assertThatThrownBy(() -> filter.filter(request(), timeout)).isInstanceOf(ResourceAccessException.class);
        assertThat(attempts).hasSize(1);
    }

    @Test
    void rejectsImmediatelyWhenTooManyRequestsAreInFlight() throws Exception {
        UpstreamFilter filter = filter(1, 3);
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        Thread slow = Thread.ofVirtual().start(() -> {
            try {
                filter.filter(request(), request -> {
                    entered.countDown();
                    release.await();
                    return ServerResponse.ok().build();
                });
            } catch (Exception ignored) {
                // không xảy ra
            }
        });
        assertThat(entered.await(5, TimeUnit.SECONDS)).isTrue();

        assertThatThrownBy(() -> filter.filter(request(), request -> ServerResponse.ok().build()))
                .isInstanceOfSatisfying(GatewayException.class, ex -> {
                    assertThat(ex.getCode()).isEqualTo(ErrorCode.DEPENDENCY_UNAVAILABLE);
                    assertThat(ex.getRetryAfterSeconds()).isEqualTo(1);
                });

        release.countDown();
        slow.join();
        // Slot được trả lại sau khi request chậm xong
        assertThat(filter.filter(request(), request -> ServerResponse.ok().build()).statusCode().value()).isEqualTo(200);
    }
}
