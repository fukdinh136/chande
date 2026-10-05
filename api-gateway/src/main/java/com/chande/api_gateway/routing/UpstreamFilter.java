package com.chande.api_gateway.routing;

import com.chande.api_gateway.error.ErrorCode;
import com.chande.api_gateway.error.GatewayException;
import com.chande.api_gateway.error.GatewayExceptionResolver;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cloud.gateway.server.mvc.common.MvcUtils;
import org.springframework.web.servlet.function.HandlerFilterFunction;
import org.springframework.web.servlet.function.HandlerFunction;
import org.springframework.web.servlet.function.ServerRequest;
import org.springframework.web.servlet.function.ServerResponse;

import java.net.URI;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.Semaphore;

/**
 * Chọn instance đích cho mỗi request của một service:
 * <ul>
 *   <li><b>Giới hạn đồng thời (bulkhead):</b> mỗi service chỉ có tối đa N request đang chờ trả lời.
 *       Service chậm không kéo cả gateway và các service khác chậm theo; vượt giới hạn trả 503 ngay.</li>
 *   <li><b>Chia tải:</b> round-robin qua các instance.</li>
 *   <li><b>Failover:</b> chỉ khi KHÔNG kết nối được (request chưa tới service) mới gửi lại sang
 *       instance khác. Timeout khi đang chờ trả lời thì không gửi lại, vì service có thể đã xử lý;
 *       app tự retry với cùng Idempotency-Key theo tài liệu.</li>
 * </ul>
 */
public class UpstreamFilter implements HandlerFilterFunction<ServerResponse, ServerResponse> {

    private static final Logger log = LoggerFactory.getLogger(UpstreamFilter.class);

    private final String serviceId;
    private final ServiceInstanceSelector instances;
    private final Semaphore inFlight;
    private final int maxConcurrentRequests;
    private final int maxAttempts;

    public UpstreamFilter(String serviceId, ServiceInstanceSelector instances,
                          int maxConcurrentRequests, int maxAttempts) {
        this.serviceId = serviceId;
        this.instances = instances;
        this.maxConcurrentRequests = maxConcurrentRequests;
        this.inFlight = new Semaphore(maxConcurrentRequests);
        this.maxAttempts = Math.min(maxAttempts, instances.size());
    }

    @Override
    public ServerResponse filter(ServerRequest request, HandlerFunction<ServerResponse> next) throws Exception {
        if (!inFlight.tryAcquire()) {
            log.warn("{} quá tải: đã có {} request đang chờ, từ chối {} {}",
                    serviceId, maxConcurrentRequests, request.method(), request.path());
            throw new GatewayException(ErrorCode.DEPENDENCY_UNAVAILABLE, 1);
        }
        try {
            Set<URI> tried = new HashSet<>();
            while (true) {
                URI instance = instances.choose(tried);
                MvcUtils.setRequestUrl(request, instance);
                try {
                    ServerResponse response = next.handle(request);
                    instances.markAvailable(instance);
                    return response;
                } catch (Exception ex) {
                    if (!GatewayExceptionResolver.isConnectFailure(ex)) {
                        throw ex;
                    }
                    instances.markUnavailable(instance);
                    tried.add(instance);
                    if (tried.size() >= maxAttempts) {
                        throw ex;
                    }
                    log.warn("Không kết nối được {} ({}), chuyển {} {} sang instance khác",
                            instance, serviceId, request.method(), request.path());
                }
            }
        } finally {
            inFlight.release();
        }
    }
}
