package com.chande.api_gateway.realtime;

/**
 * Chuyển vị trí tài xế sang Realtime Location service (theo sơ đồ C2: Gateway → Realtime Location).
 * Contract giữa hai bên chưa được chốt nên hiện chỉ có {@link LoggingLocationForwarder}.
 * Khi nhóm Realtime Location chốt API, thêm một bean cài đặt interface này để thay thế.
 */
public interface LocationForwarder {

    void forward(DriverLocation location);
}
