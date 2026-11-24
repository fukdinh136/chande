package com.chande.api_gateway.events;

import com.chande.api_gateway.realtime.TripEvent;
import com.chande.api_gateway.realtime.TripEventInbox;
import com.chande.api_gateway.realtime.TripEventParser;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.data.redis.RedisConnectionFailureException;
import tools.jackson.databind.json.JsonMapper;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** ADR-0002: Gateway nhận sự kiện chuyến từ RabbitMQ — ack, DLQ hay retry theo từng kết quả. */
class TripEventBusListenerTest {

    private static final String ASSIGNED = """
            {"schemaVersion":1,"eventId":"60000000-0000-4000-8000-000000000002","type":"trip.assigned",
             "tripId":"20000000-0000-4000-8000-000000000001","tripVersion":2,"occurredAt":"2026-10-05T02:02:00.000Z",
             "data":{"riderId":"30000000-0000-4000-8000-000000000001",
                     "driverId":"40000000-0000-4000-8000-000000000001","status":"ASSIGNED"}}""";

    private final TripEventInbox inbox = mock(TripEventInbox.class);
    private final RabbitTemplate rabbit = mock(RabbitTemplate.class);
    private final TripEventBusListener listener =
            new TripEventBusListener(new TripEventParser(JsonMapper.builder().build()), inbox, rabbit, 3);

    private static Message message(String body, long rejected) {
        MessageProperties properties = new MessageProperties();
        properties.setMessageId("60000000-0000-4000-8000-000000000002");
        if (rejected > 0) {
            List<Map<String, ?>> deaths = new ArrayList<>();
            deaths.add(Map.of("queue", TripEventBusConfig.QUEUE, "reason", "rejected", "count", rejected));
            deaths.add(Map.of("queue", TripEventBusConfig.RETRY_QUEUE, "reason", "expired", "count", rejected));
            properties.setHeader("x-death", deaths);
        }
        return new Message(body.getBytes(StandardCharsets.UTF_8), properties);
    }

    @Test
    void storesEachOutcomeExceptConflictWithoutParking() {
        for (TripEventInbox.Outcome outcome : List.of(TripEventInbox.Outcome.ACCEPTED, TripEventInbox.Outcome.DUPLICATE, TripEventInbox.Outcome.STALE)) {
            when(inbox.store(any(TripEvent.class))).thenReturn(outcome);
            listener.receive(message(ASSIGNED, 0));
        }
        verify(rabbit, never()).send(any(String.class), any(String.class), any(Message.class));
    }

    @Test
    void conflictAndBrokenMessagesGoToTheDeadLetterQueue() {
        when(inbox.store(any(TripEvent.class))).thenReturn(TripEventInbox.Outcome.CONFLICT);
        listener.receive(message(ASSIGNED, 0));
        listener.receive(message("{not json", 0));
        verify(rabbit).send(eq(""), eq(TripEventBusConfig.DEAD_LETTER_QUEUE),
                argThat(m -> "EVENT_ID_REUSED".equals(m.getMessageProperties().getHeader("x-gateway-reason"))));
        verify(rabbit).send(eq(""), eq(TripEventBusConfig.DEAD_LETTER_QUEUE),
                argThat(m -> "INVALID_EVENT".equals(m.getMessageProperties().getHeader("x-gateway-reason"))));
    }

    @Test
    void redisFailureIsRetriedUntilTheLimitThenParked() {
        when(inbox.store(any(TripEvent.class))).thenThrow(new RedisConnectionFailureException("down"));
        assertThatThrownBy(() -> listener.receive(message(ASSIGNED, 2))).isInstanceOf(RedisConnectionFailureException.class);
        assertThat(TripEventBusListener.previousAttempts(message(ASSIGNED, 2))).isEqualTo(2);
        listener.receive(message(ASSIGNED, 3));
        verify(rabbit).send(eq(""), eq(TripEventBusConfig.DEAD_LETTER_QUEUE),
                argThat(m -> "RETRIES_EXHAUSTED".equals(m.getMessageProperties().getHeader("x-gateway-reason"))));
    }
}
