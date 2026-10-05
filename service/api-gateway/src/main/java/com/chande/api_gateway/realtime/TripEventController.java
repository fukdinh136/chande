package com.chande.api_gateway.realtime;

import com.chande.api_gateway.error.ErrorCode;
import com.chande.api_gateway.error.GatewayException;
import com.chande.api_gateway.web.RequestIdFilter;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code POST /internal/events/trips} — Trip gửi sự kiện trạng thái chuyến (tài liệu Trip mục 11–12, O05).
 * 202 nghĩa là gateway đã lưu sự kiện, KHÔNG có nghĩa thiết bị đã nhận. Trip retry cùng eventId khi lỗi.
 */
@RestController
public class TripEventController {

    private static final Logger log = LoggerFactory.getLogger(TripEventController.class);

    private final TripEventParser parser;
    private final TripEventInbox inbox;

    public TripEventController(TripEventParser parser, TripEventInbox inbox) {
        this.parser = parser;
        this.inbox = inbox;
    }

    @PostMapping(path = "/internal/events/trips", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> receive(@RequestBody byte[] body, HttpServletRequest request) {
        TripEvent event = parser.parse(body);
        TripEventInbox.Outcome outcome = inbox.store(event);
        if (outcome == TripEventInbox.Outcome.CONFLICT) {
            throw new GatewayException(ErrorCode.EVENT_ID_REUSED);
        }
        log.info("Sự kiện {} chuyến {} v{} -> {}", event.type(), event.tripId(), event.tripVersion(), outcome);

        String json = "{\"data\":{\"eventId\":\"" + event.eventId() + "\",\"accepted\":true},"
                + "\"meta\":{\"requestId\":\"" + RequestIdFilter.requestId(request) + "\"}}";
        return ResponseEntity.accepted()
                .contentType(MediaType.APPLICATION_JSON)
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .body(json);
    }
}
