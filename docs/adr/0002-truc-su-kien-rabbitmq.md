# ADR-0002: Trục sự kiện qua RabbitMQ topic exchange

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Trip, API Gateway, Payment, Price, Driver |
| Rà soát | 2026-10-27 |
| Quy ước | [Format và số liệu](../quy-uoc-tai-lieu.md) |

## Trạng thái

Đề xuất — phase 1, cải tiến P1.3 trong [Kiến trúc mục tiêu](../kien-truc-muc-tieu.md).

## Bối cảnh

Trip có transactional outbox tốt: ghi chuyến và outbox trong cùng transaction, bảng `outbox_deliveries` có một dòng cho mỗi đích, worker POST HTTP tới từng đích và retry. Hiện có các đích `matching` (lệnh tìm / huỷ), `gateway` và `notification`, trong đó hai đích sau cùng trỏ vào Gateway.

Phase 2 thêm ít nhất 3 bên cần nghe event chuyến: Payment, Price (cầu cho surge, khuyến mãi), Driver (đánh giá). Với mô hình hiện tại, mỗi bên mới buộc phải sửa Trip: thêm đích, URL, token và cột `CHECK` trong migration. Trip biết quá nhiều về người nghe.

Các ứng dụng đặt xe lớn dùng một trục event chung (thường là Kafka): producer không biết consumer, service mới tự subscribe.

## Quyết định

- Thêm topic exchange `trip.events` (durable) trên RabbitMQ đang có. Routing key bằng tên event: `trip.searching`, `trip.assigned`, `trip.driver_arrived`, `trip.started`, `trip.completed`, `trip.cancelled`, và ở phase 2 `trip.rated`.
- Outbox của Trip thay hai đích `gateway`, `notification` bằng một đích `bus`. Worker publish với **publisher confirm**; chỉ đánh dấu delivered sau khi broker xác nhận.
- Lệnh Trip → Matching (`search`, `cancel`) **giữ HTTP**: đây là lệnh có đúng một người nhận và đã có idempotency.
- Mỗi consumer có queue riêng (`gateway.trip-events`, `payment.trip-events`, …), DLX và retry có giới hạn.
- Consumer lưu `eventId` đã xử lý trong bảng inbox cùng transaction với hiệu ứng nghiệp vụ, để xử lý đúng một lần về mặt hiệu ứng (at-least-once delivery + idempotent consumer).
- Envelope chung: `eventId`, `type`, `occurredAt`, `tripId`, `version`, `data`. Gateway bỏ event có `version` nhỏ hơn bản đã đẩy cho client.
- Trace context (`traceparent`) đi trong header AMQP (xem [ADR-0003](0003-observability-opentelemetry.md)).

## Phương án đã cân nhắc

| Phương án | Lý do không chọn |
| --- | --- |
| Kafka | Giống hệ thống lớn hơn, nhưng thêm ~1 GB RAM, thêm công nghệ mới và công chuyển đổi trong 2–3 tuần; quy mô demo không cần log có thể replay |
| Giữ fan-out HTTP, thêm đích cho mỗi service mới | Trip phải sửa mỗi lần có người nghe mới; vi phạm nguyên tắc mở rộng không sửa |
| Debezium / CDC đọc WAL | Thêm hạ tầng nặng; outbox polling hiện có đã đủ |

## Hệ quả

- Tích cực: thêm consumer không cần sửa Trip; Gateway tắt vẫn không mất event (queue giữ lại); dễ minh hoạ event-driven trên sơ đồ C2.
- Tiêu cực: thêm một điểm cần vận hành (exchange, queue, DLX); thứ tự chỉ được đảm bảo trong một queue, nên consumer phải dựa vào `version`.
- RabbitMQ thành phụ thuộc quan trọng hơn: outbox vẫn bảo vệ phía Trip (broker chết thì event nằm chờ trong DB).

## Tiêu chí hoàn thành

- Trip không còn biến `GATEWAY_EVENTS_*`, `NOTIFICATION_*`; Gateway không còn endpoint nhận POST event từ Trip.
- Tắt Gateway 1 phút trong lúc chạy chuyến; sau khi bật lại, khách nhận đủ event đúng thứ tự.
- Replay cùng một message không tạo hiệu ứng lặp ở consumer (có test).
