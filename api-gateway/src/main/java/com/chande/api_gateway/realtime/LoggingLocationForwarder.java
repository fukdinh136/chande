package com.chande.api_gateway.realtime;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Cài đặt giữ chỗ: chỉ ghi log. TODO: thay bằng client gọi Realtime Location service khi có contract.
 */
@Component
public class LoggingLocationForwarder implements LocationForwarder {

    private static final Logger log = LoggerFactory.getLogger(LoggingLocationForwarder.class);

    @Override
    public void forward(DriverLocation location) {
        log.debug("Vị trí tài xế {}: {},{}", location.driverId(), location.lat(), location.lng());
    }
}
