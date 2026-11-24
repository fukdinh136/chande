package com.chande.api_gateway.events;

import com.chande.api_gateway.error.GatewayException;
import com.chande.api_gateway.realtime.TripEvent;
import com.chande.api_gateway.realtime.TripEventInbox;
import com.chande.api_gateway.realtime.TripEventParser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

/**
 * ADR-0002: nhận sự kiện chuyến từ RabbitMQ thay cho {@code POST /internal/events/trips}. Cùng parser và cùng inbox
 * Redis như đường HTTP, nên gửi lại một message không phát lại sự kiện (chống trùng theo eventId, bỏ version cũ).
 * <ul>
 *   <li>Lưu được (mới, trùng, cũ hơn): ack.</li>
 *   <li>Message hỏng hoặc eventId dùng lại cho nội dung khác: chuyển sang DLQ, không retry.</li>
 *   <li>Lỗi tạm thời (Redis): ném lỗi → reject → retry sau 5 giây, tối đa {@code max-attempts} lần rồi vào DLQ.</li>
 * </ul>
 */
@Component
@ConditionalOnProperty(name = "gateway.events.bus.enabled", havingValue = "true")
public class TripEventBusListener {

    private static final Logger log = LoggerFactory.getLogger(TripEventBusListener.class);

    private final TripEventParser parser;
    private final TripEventInbox inbox;
    private final RabbitTemplate rabbit;
    private final int maxAttempts;

    public TripEventBusListener(TripEventParser parser, TripEventInbox inbox, RabbitTemplate rabbit,
                                @Value("${gateway.events.bus.max-attempts:60}") int maxAttempts) {
        this.parser = parser;
        this.inbox = inbox;
        this.rabbit = rabbit;
        this.maxAttempts = maxAttempts;
    }

    @RabbitListener(queues = TripEventBusConfig.QUEUE, concurrency = "${gateway.events.bus.consumers:2}")
    public void receive(Message message) {
        long attempts = previousAttempts(message);
        if (attempts >= maxAttempts) {
            park(message, "RETRIES_EXHAUSTED");
            return;
        }
        TripEvent event;
        try {
            event = parser.parse(message.getBody());
        } catch (GatewayException e) {
            park(message, "INVALID_EVENT");
            return;
        }
        TripEventInbox.Outcome outcome = inbox.store(event);
        if (outcome == TripEventInbox.Outcome.CONFLICT) {
            park(message, "EVENT_ID_REUSED");
            return;
        }
        log.info("Sự kiện {} chuyến {} v{} qua RabbitMQ -> {}", event.type(), event.tripId(), event.tripVersion(), outcome);
    }

    /** Số lần message đã bị reject khỏi queue chính (header x-death do RabbitMQ ghi khi qua DLX). */
    static long previousAttempts(Message message) {
        List<Map<String, ?>> deaths = message.getMessageProperties().getXDeathHeader();
        if (deaths == null) {
            return 0;
        }
        return deaths.stream()
                .filter(d -> TripEventBusConfig.QUEUE.equals(d.get("queue")) && "rejected".equals(d.get("reason")))
                .map(d -> d.get("count"))
                .filter(Number.class::isInstance)
                .mapToLong(c -> ((Number) c).longValue())
                .sum();
    }

    private void park(Message message, String reason) {
        message.getMessageProperties().setHeader("x-gateway-reason", reason);
        rabbit.send("", TripEventBusConfig.DEAD_LETTER_QUEUE, message);
        log.warn("Sự kiện chuyến {} chuyển sang {}: {}", message.getMessageProperties().getMessageId(),
                TripEventBusConfig.DEAD_LETTER_QUEUE, reason);
    }
}
