package com.chande.api_gateway.events;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.Declarables;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * ADR-0002: hàng đợi riêng của Gateway trên exchange {@code trip.events}. Trip không biết queue này; consumer mới
 * (Payment, Price...) chỉ cần khai báo queue của mình. Lỗi tạm thời đi qua hàng chờ retry 5 giây; message hỏng
 * hoặc hết lượt retry nằm ở DLQ để xem lại.
 */
@Configuration
@ConditionalOnProperty(name = "gateway.events.bus.enabled", havingValue = "true")
public class TripEventBusConfig {

    public static final String EXCHANGE = "trip.events";
    public static final String QUEUE = "gateway.trip-events";
    public static final String RETRY_QUEUE = QUEUE + ".retry";
    public static final String DEAD_LETTER_QUEUE = QUEUE + ".dlq";
    static final int RETRY_DELAY_MS = 5000;

    @Bean
    Declarables tripEventTopology() {
        TopicExchange exchange = new TopicExchange(EXCHANGE, true, false);
        // Bị reject → exchange mặc định → hàng chờ retry; hết TTL → quay về queue chính
        Queue queue = QueueBuilder.durable(QUEUE)
                .deadLetterExchange("").deadLetterRoutingKey(RETRY_QUEUE).build();
        Queue retry = QueueBuilder.durable(RETRY_QUEUE).ttl(RETRY_DELAY_MS)
                .deadLetterExchange("").deadLetterRoutingKey(QUEUE).build();
        Queue dead = QueueBuilder.durable(DEAD_LETTER_QUEUE).build();
        Binding binding = BindingBuilder.bind(queue).to(exchange).with("trip.#");
        return new Declarables(exchange, queue, retry, dead, binding);
    }
}
