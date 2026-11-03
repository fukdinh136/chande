# ADR-0003: Observability bằng OpenTelemetry, Prometheus, Grafana, Jaeger

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Toàn hệ thống |
| Rà soát | 2026-10-27 |
| Quy ước | [Format và số liệu](../quy-uoc-tai-lieu.md) |

## Trạng thái

Đề xuất — phase 1, cải tiến P1.4 trong [Kiến trúc mục tiêu](../kien-truc-muc-tieu.md).

## Bối cảnh

Hệ thống có 8 service và 3 hạ tầng nhắn tin / lưu trữ. Hiện chỉ có `X-Request-Id` được truyền qua HTTP và log JSON. Không có metric, không có trace, nên không trả lời được các câu hỏi như "job tìm xe chậm ở bước nào", "tỉ lệ offer bị bỏ qua là bao nhiêu" hay "p95 báo giá là bao nhiêu".

Hội đồng chấm nặng chất lượng kỹ thuật. Distributed tracing là kỹ thuật chuẩn của hệ thống microservice; Jaeger được phát triển ở Uber cho chính bài toán này.

Ràng buộc: demo trên MacBook 16 GB, giữ stack hiện tại, chỉ thêm observability.

## Quyết định

| Thành phần | Lựa chọn |
| --- | --- |
| Instrument Node (Trip, Matching, Driver, Realtime, Price, Routing) | `@opentelemetry/sdk-node` + auto-instrumentation cho HTTP, `pg`, `ioredis`, `amqplib`, nạp từ một module bootstrap dùng chung trước NestJS |
| Instrument Java (Gateway, User, Payment) | OpenTelemetry Java agent; Gateway thêm Micrometer. Nếu JDK `HttpServer` của User không được agent tự instrument thì thêm span thủ công ở adapter HTTP |
| Thu thập | OpenTelemetry Collector nhận OTLP |
| Trace | Jaeger all-in-one, lưu in-memory |
| Metric | Prometheus scrape Collector, retention 2 ngày |
| Dashboard | Grafana, dashboard commit dạng JSON provisioning |
| Log | Giữ log JSON hiện có, thêm `traceId` / `spanId`; không thêm Loki để tiết kiệm RAM |
| Bật / tắt | Cờ riêng khi sinh manifest Docker / Kubernetes; tắt thì SDK dùng exporter no-op |

Dashboard bắt buộc: RED (rate, error, duration) cho mọi service; funnel matching (vị trí → eligible → matrix → offer → accept); độ trễ outbox; ở phase 2 thêm bản đồ surge.

`X-Request-Id` được giữ để tương thích, gắn vào span dưới dạng attribute.

## Phương án đã cân nhắc

| Phương án | Lý do không chọn |
| --- | --- |
| Grafana Tempo + Loki thay Jaeger | Đầy đủ hơn nhưng nặng hơn; Jaeger UI dễ trình bày một trace cho hội đồng |
| Chỉ metric (Prometheus client) không có trace | Không trả lời được câu hỏi "chậm ở service nào" trong chuỗi gọi |
| Vendor SaaS (Datadog, New Relic) | Cần mạng và tài khoản; demo offline không ổn định |

## Hệ quả

- Tích cực: có bằng chứng định lượng cho báo cáo; debug luồng xuyên service nhanh hơn; P1.1 và P2.5 có cách kiểm chứng trực quan.
- Tiêu cực: thêm ~0,8 GB RAM; thời gian khởi động service tăng nhẹ; cần giữ tên metric ổn định.

## Tiêu chí hoàn thành

- Một chuyến demo xuất hiện thành một trace liền mạch Gateway → Trip → Matching → Realtime / Driver / Routing, gồm cả bước qua RabbitMQ.
- Dashboard RED và funnel matching có dữ liệu thật sau một lần chạy smoke.
- Tắt cờ observability thì stack vẫn chạy bình thường.
