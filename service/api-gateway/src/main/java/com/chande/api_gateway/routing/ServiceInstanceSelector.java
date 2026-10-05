package com.chande.api_gateway.routing;

import java.net.URI;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.LongSupplier;

/**
 * Chia đều request cho các instance của một service (round-robin). Instance vừa không kết nối được
 * bị tạm bỏ qua trong {@code cooldown}; nếu mọi instance đều đang bị bỏ qua thì vẫn thử lại
 * (có thể instance đã sống lại) thay vì từ chối ngay.
 */
public class ServiceInstanceSelector {

    private final List<URI> instances;
    private final long cooldownNanos;
    private final LongSupplier nanoTime;
    private final AtomicInteger cursor = new AtomicInteger();
    private final Map<URI, Long> unavailableUntil = new ConcurrentHashMap<>();

    public ServiceInstanceSelector(List<URI> instances, Duration cooldown) {
        this(instances, cooldown, System::nanoTime);
    }

    ServiceInstanceSelector(List<URI> instances, Duration cooldown, LongSupplier nanoTime) {
        this.instances = List.copyOf(instances);
        this.cooldownNanos = cooldown.toNanos();
        this.nanoTime = nanoTime;
    }

    /**
     * @param exclude các instance đã thử (và thất bại) trong request hiện tại
     * @return instance tiếp theo, hoặc {@code null} nếu đã thử hết
     */
    public URI choose(Set<URI> exclude) {
        int size = instances.size();
        int start = Math.floorMod(cursor.getAndIncrement(), size);
        URI fallback = null;
        for (int i = 0; i < size; i++) {
            URI candidate = instances.get((start + i) % size);
            if (exclude.contains(candidate)) {
                continue;
            }
            if (isAvailable(candidate)) {
                return candidate;
            }
            if (fallback == null) {
                fallback = candidate;
            }
        }
        return fallback;
    }

    public void markUnavailable(URI instance) {
        unavailableUntil.put(instance, nanoTime.getAsLong() + cooldownNanos);
    }

    public void markAvailable(URI instance) {
        if (!unavailableUntil.isEmpty()) {
            unavailableUntil.remove(instance);
        }
    }

    public int size() {
        return instances.size();
    }

    private boolean isAvailable(URI instance) {
        Long until = unavailableUntil.get(instance);
        return until == null || nanoTime.getAsLong() - until >= 0;
    }
}
