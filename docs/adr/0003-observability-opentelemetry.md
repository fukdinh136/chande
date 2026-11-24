# ADR-0003: Observability bằng OpenTelemetry, Prometheus, Grafana, Jaeger

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Toàn hệ thống |
| Rà soát | 2026-11-10 |
| Quy ước | [Format và số liệu](../quy-uoc-tai-lieu.md) |

## Trạng thái

Chấp nhận một phần (2026-11-10) — phase 1, cải tiến P1.4 trong [Kiến trúc mục tiêu](../kien-truc-muc-tieu.md). Sáu service Node, Collector, Jaeger, Prometheus và Grafana đã triển khai và kiểm chứng trên Kubernetes local; ba service Java (Gateway, User, Payment) chưa làm. Chi tiết ở mục [Đã triển khai](#đã-triển-khai-2026-11-10).

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
- Tiêu cực: thêm ~0,8 GB RAM; CPU các service Node tăng 20–50% khi bật (đo 2026-11-10); thời gian khởi động service tăng nhẹ; cần giữ tên metric ổn định.

## Tiêu chí hoàn thành

- Một chuyến demo xuất hiện thành một trace liền mạch Gateway → Trip → Matching → Realtime / Driver / Routing, gồm cả bước qua RabbitMQ.
- Dashboard RED và funnel matching có dữ liệu thật sau một lần chạy smoke.
- Tắt cờ observability thì stack vẫn chạy bình thường.

## Đã triển khai (2026-11-10)

Nhánh `perf/adr-0008-trip-outbox`, commit `7ae5bd2`, `abea764`, `9a6ee48`, `06bfc2b`. Số đo ở [báo cáo kiểm thử tải, mục 12](../bao-cao-kiem-thu-tai.md#12-đo-lại-với-observability-2026-11-10); cách bật ở [deploy backend](../deploy-backend.md#observability-tuỳ-chọn).

| Phần | Hiện trạng |
| --- | --- |
| Bootstrap | `src/bootstrap/telemetry.ts`, giống hệt nhau ở sáu service Node (có test so sánh), là import đầu tiên của mọi entry point. Không có `OTEL_EXPORTER_OTLP_ENDPOINT` thì không nạp gói OpenTelemetry nào |
| Tự instrument | HTTP vào và ra (bỏ `/health`), `fetch`, `pg`, `ioredis`, `amqplib`, số đo runtime Node (event loop, heap, GC) |
| Metric riêng | Matching: thời gian từng bước tìm xe, số tài xế còn lại sau mỗi bước, kết quả tìm, thời gian job, độ trễ outbox offer. Trip: độ trễ và số lần gửi outbox theo đích. Routing: số lần từ chối theo lý do, hàng chờ và thời gian chờ worker pool. Realtime: thời gian xử lý GPS, số socket tài xế |
| Span thủ công | `matching.job` (một job của worker), `trip.outbox.deliver` (một lần gửi outbox), `driver.location.update` (một bản tin GPS) |
| Hạ tầng | Collector `0.119.0` → Jaeger `1.65.0` (in-memory, 4000 trace) và Prometheus `v3.1.0` (2 ngày) → Grafana `11.4.0`, dashboard `chande-overview` nạp sẵn từ [chande-overview.json](../../deploy/observability/chande-overview.json) |
| Bật / tắt | `OBSERVABILITY=on` khi chạy `generate`, `docker-up` hoặc `kube-up`. Tắt (mặc định) thì manifest giống hệt trước đây và stack observability bị gỡ |
| Lấy mẫu trace | `OTEL_SAMPLE_RATIO`, mặc định 0,1; metric không lấy mẫu |

### Khác với quyết định ban đầu

| Điểm | Quyết định | Thực tế | Lý do |
| --- | --- | --- | --- |
| Service Java | Java agent cho Gateway, User, Payment | Chưa làm | Điểm nghẽn đo được đều nằm ở service Node; làm sau, không chặn việc đo |
| Trace liền mạch | Một trace Gateway → Trip → Matching → Realtime | Ba đoạn trace cho một chuyến: (1) request của khách ở Trip và các service nó gọi; (2) `trip.outbox.deliver` → Matching; (3) `matching.job` → Realtime, Driver, Routing → RabbitMQ → Realtime | Outbox Trip và hàng job Matching được đọc lại từ database nên ngữ cảnh trace không đi theo. Nối lại cần lưu `traceparent` vào dòng outbox (đổi schema), để sau. Gateway chưa có trace |
| Nhãn theo route | Không nêu | Metric HTTP có `job`, method, mã trạng thái; không có nhãn route | Instrumentation HTTP không biết route của NestJS; xem theo route thì dùng trace |
| Log có `traceId` | Thêm vào log JSON | Chưa làm | Không cần cho việc tìm điểm nghẽn |
| Funnel matching | Vị trí → eligible → matrix → offer → accept | Gần → còn trống → đủ điều kiện → xếp hạng (theo [ADR-0001](0001-matching-so-huu-tim-ung-vien.md)) | Offer và accept xem ở outbox và trạng thái chuyến |
| RAM | Khoảng 0,8 GB | Giới hạn 1,5 GiB (Collector 256, Jaeger 512, Prometheus 512, Grafana 256 MiB); dùng thật khoảng 0,8 GiB khi đo tải, chưa kể Collector (không đo được) | Jaeger cần giới hạn số trace để ở trong 512 MiB |

### Bài học khi chạy thật

- Image Collector `0.116.0` không khởi động được trên arm64 (`exec /otelcol-contrib: no such file or directory`); dùng `0.119.0`.
- Jaeger giữ 50000 trace thì đầy 512 MiB ở 16 chuyến/giây, dùng 1,5 core để thu gom bộ nhớ và mất ready. Hai nguyên nhân: giới hạn trace quá cao, và các vòng poll của worker sinh hàng nghìn span truy vấn lẻ mỗi phút. Đã sửa: 4000 trace với `GOMEMLIMIT=400MiB` (10000 vẫn đầy ở 20 chuyến/giây); truy vấn `pg` không nằm trong span nào thì không ghi; job và lần gửi outbox có span riêng. Sau sửa, Jaeger dùng 0,02 core và 417 MiB ở 24 chuyến/giây.

### Đối chiếu tiêu chí hoàn thành

| Tiêu chí | Kết quả |
| --- | --- |
| Một chuyến thành một trace liền mạch, gồm bước qua RabbitMQ | Một phần: ba đoạn trace như trên; bước qua RabbitMQ có trong đoạn (3) |
| Dashboard RED và funnel matching có dữ liệu thật sau smoke | Đạt: 25 truy vấn của dashboard đều có dữ liệu sau smoke và một lần đo tải |
| Tắt cờ thì stack chạy bình thường | Đạt: `kube-up` không cờ gỡ stack observability, smoke xanh |

