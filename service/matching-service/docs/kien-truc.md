# Kiến trúc Matching v1

| Thuộc tính | Giá trị |
| --- | --- |
| Service | matching-service |
| Rà soát | 2026-11-16 |
| Quy ước | [Format và số liệu](../../../docs/quy-uoc-tai-lieu.md) |

```mermaid
flowchart LR
  Trip --> Controller[Matching Controller]
  Controller --> Decisions[Search / Offer Decisions]
  Decisions --> DB[(Matching PostgreSQL)]
  Worker[Worker: pool tối đa 16 job] --> Decisions
  Worker --> RealtimeClient --> Realtime[Realtime: vị trí gần nhất]
  Worker --> DriverClient --> Driver[Driver: điều kiện theo lô]
  Worker --> RoutingClient --> Routing[Routing: ETA matrix]
  Worker --> TripClient --> Trip
  DB --> Publisher --> RabbitMQ --> Consumer[Realtime Offer Consumer]
  Consumer --> Redis[(Realtime Redis)]
  Consumer --> DriverApp[Driver App: authenticated room]
  DriverApp --> Controller
```

Controller xác thực/validate/correlation; domain giữ chuyển trạng thái và ranking; application điều phối HTTP ngoài transaction; persistence lưu search/offer/reservation/receipt/outbox. Database constraints bảo vệ một reservation/driver và một offer chờ/trip. Worker lease có hạn để phục hồi process chết, khác reservation nghiệp vụ.

Trip là nguồn xác nhận assignment. Callback 202 nghĩa assignment đã commit; response mất được đối soát qua matching-state. Không giải phóng reservation pending chỉ vì deadline HTTP. Terminal marker và idempotency receipt được lưu bền vững.

RabbitMQ durable exchange/queue, persistent message, publisher confirms và mandatory routing. Consumer ACK sau cache/kiểm tra trạng thái/attempt phát. Retry có backoff, malformed đi DLQ. Redis giữ version/tombstone để message đảo thứ tự không hồi sinh offer. Reconnect truy vấn Matching trước phát lại.

Broker confirm xác nhận broker nhận message, không chứng minh Driver App đã nhận; ứng dụng deduplicate theo offer ID/version và lấy lại trạng thái khi reconnect. Tham chiếu [RabbitMQ acknowledgements/confirms](https://www.rabbitmq.com/docs/confirms) và [amqplib Channel API](https://amqp-node.github.io/amqplib/channel_api.html).

Một process API, một process worker, một Realtime replica v1. Shutdown ngừng nhận job rồi chờ I/O có timeout; khởi động lại xử lý offer quá hạn và outbox chưa ACK.

| Component | Input → output | Kiểm chứng và mã nguồn |
| --- | --- | --- |
| API | Trip command/JWT decision → durable ACK/status | strict body, caller scope, ownership/idempotency; src/api/app.ts |
| Domain | search/offer/clock → transition/ranking | deadline đúng biên, terminal không mở lại, sort ổn định; src/domain/models.ts |
| MatchDriver / DirectCandidates | search → một offer/reservation | vị trí từ Realtime (≤200), điều kiện theo lô từ Driver (≤100), ETA cho 25 người gần nhất từ Routing; freshness/tried/busy, transaction cạnh tranh; application/match.ts, application/candidates.ts |
| OfferDecisions | driver/key/action → receipt | accept chưa phải assigned; decline giải phóng và tìm tiếp; application/decisions.ts |
| AssignDriver | frozen event/snapshot → Trip confirmation | uncertain callback giữ reservation, cancel không mở lại; application/decisions.ts |
| Clients | ports → Realtime/Driver/Routing/Trip HTTP | timeout, redirect error, schema/identity/ACK, response cap; mỗi dependency một circuit breaker (D1): 5 lỗi liên tiếp thì trả `CIRCUIT_OPEN` 5 giây; infrastructure/clients.ts, circuit-breaker.ts |
| Repository | aggregate → PostgreSQL | unique active offer/reservation, receipt, terminal marker, lease; infrastructure/persistence.ts |
| Worker / expiry | due jobs/expired offers → bounded processing | pool tối đa `WORKER_CONCURRENCY` job, job xong là lấy job mới ([ADR-0008](../../../docs/adr/0008-xu-ly-hang-doi-lien-tuc.md)); lấy job gán chuyến trước rồi chuyến đặt sớm nhất (Priority Queue); lease renewal; thử lại sớm khi dependency bận (A7) trong ngân sách 20% số job (D1); expiry độc lập I/O; application/worker.ts, retry.ts, expiry.ts |
| Publisher | outbox → confirmed Rabbit message | vòng riêng, được đánh thức ngay khi có offer, chạy tiếp khi lô đầy (ADR-0008); index riêng cho tin chưa gửi; persistent/mandatory/confirm; cùng ID khi retry; infrastructure/publisher.ts |
| Dọn outbox | tin đã publish quá `OUTBOX_RETENTION_MS` → xoá theo lô | chỉ replica giữ advisory lock `leader:matching-outbox-purge` chạy (Leader Election); worker.ts, infrastructure/leader.ts |
| Realtime consumer | Rabbit/current offer → Redis/driver room | manual ACK, backoff/DLQ, version/tombstone, reconnect; realtime-service/src/infrastructure/offers/consumer.ts |

Reservation không hết hạn theo worker lease. Offer có `assignmentAttempted` trong JSON để lần retry sau timeout không đánh giá lại Driver rồi tự giải phóng khi callback cũ có thể vẫn commit. HTTP chạy ngoài transaction; transaction recheck search/offer trước gửi/lưu kết quả. Expiry sweep dùng cùng thứ tự lock search→offer như accept/cancel.
