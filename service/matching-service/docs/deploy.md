# Deploy

| Thuộc tính | Giá trị |
| --- | --- |
| Service | matching-service |
| Rà soát | 2026-10-06 |
| Quy ước | [Format và số liệu](../../../docs/quy-uoc-tai-lieu.md) |

Matching API mặc định 3007. Local tích hợp dùng Driver 3008, Realtime 3009 để tránh Trip mock 3003 và Routing 3004. Một worker, tối đa 16 job async đồng thời; polling 5 giây, expiry scan 250 ms; retry nominal 1–30 giây với jitter hệ số 0.8–1.0 (delay thực có thể từ 800 ms).

Copy .env.example ra .env và điền credential riêng; không commit env/key. Node 24: npm ci, npm run build, npm run migration:run, npm run start:prod; worker chạy npm run worker:prod. Migration là lệnh riêng trước API/worker, không synchronize schema.

PostgreSQL riêng cho Matching; Redis của Driver/Realtime do từng service sở hữu; RabbitMQ có volume riêng. Không xóa volume existing. CAR_4/CAR_7 dùng graph OSRM Hà Nội hiện có. Không cấu hình BIKE real bằng profile bicycle/car.

Readiness kiểm tra schema/database. Worker và consumer reconnect có backoff; không trả thành công khi durable write thất bại. Requeue outbox giữ eventId và không đổi expiresAt. DLQ chỉ replay sau khi sửa payload/nguyên nhân, kiểm tra terminal state trước giao.

## Tham số worker

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `WORKER_CONCURRENCY` | 16 (tối đa 16) | Số job tìm xe chạy cùng lúc; job xong là claim job mới ngay |
| `WORKER_SCAN_MS` | 250 | Thời gian worker nghỉ khi không còn search tới hạn, và nhịp vòng hết hạn offer |
| `SEARCH_POLL_MS` | 5000 | Hạn tìm lại khi chưa có ứng viên |
| `PUBLISHER_BATCH_MAX` | 200 (tối đa 1000) | Số tin outbox tối đa publisher gửi trong một lượt; chạm trần thì chạy lượt kế ngay |
| `PUBLISHER_SCAN_MS` | 250 | Thời gian publisher nghỉ khi hết tin hoặc khi gửi lỗi |

Worker giữ một pool tối đa `WORKER_CONCURRENCY` job: một job chậm không chặn job khác. Khi có offer `PENDING`, search được hẹn lại ngay sau `expires_at` (thêm 500 ms) thay vì kiểm tra mỗi giây; accept, decline và vòng hết hạn offer đưa search về hàng chờ ngay. Publisher offer chạy vòng riêng, không chung nhịp với worker, và được đánh thức ngay khi worker commit offer trong cùng process ([ADR-0008](../../../docs/adr/0008-xu-ly-hang-doi-lien-tuc.md)). Tin do matching-api ghi (accept, decline) được gửi theo nhịp `PUBLISHER_SCAN_MS`.

V1 một Realtime replica. Mở rộng nhiều replica cần Socket.IO adapter/room delivery và limiter toàn cụm. Hosting production, GPS traffic và OSRM BIKE ngoài nghiệm thu.

## Local Hà Nội

Stack độc lập `chande-matching-local`, giữ nguyên stack `chande-trip-local`. Ports: Matching 3007, Driver 3008, Realtime 3009; Trip 13001, issuer RIDER/mock events 13003, Routing 13004, Price 13005. Matching DB local 55436; test DB 55435 và test broker 5673. PostgreSQL/Redis/Rabbit dùng named volumes riêng của project.

```powershell
npm.cmd --prefix service/routing-service run osrm:up
Set-Location service/matching-service
npm.cmd ci
docker compose -f compose.local.yml build
docker compose -f compose.local.yml up -d --wait --wait-timeout 180
npm.cmd run smoke:local
```

Lần đầu chưa có graph: chạy `npm.cmd --prefix service/routing-service run osrm:prepare` tại repo root. Compose chỉ mở các cổng HTTP/DB trên loopback; credential trong compose chỉ dành local. Broker không expose port ra host, scheduler giới hạn để chạy ổn định trên Docker Desktop.

`test/fixtures/driver-local.sql` chỉ bootstrap database Driver mới của stack smoke và hai account CAR_4/CAR_7. Đây là fixture theo mapping runtime, không phải migration production hay DDL cho database Driver có sẵn. OTP local 123456; app tạo JWT thật từ Driver. RIDER issuer và Gateway/Notification event sink vẫn mock, vì scope nghiệm thu Matching dùng Driver/Realtime/Routing/Price/Trip runtime thật. Không dùng mock Matching hoặc mock GPS.

## Kiểm thử và vận hành

```powershell
npm.cmd test
$env:MATCHING_TEST_DATABASE_URL='postgres://matching_test:matching_test@127.0.0.1:55435/matching_test'
$env:MATCHING_TEST_RABBIT_URL='amqp://matching_test:matching_test@127.0.0.1:5673'
npm.cmd run test:integration
docker compose -f compose.local.yml restart -t 10 matching-worker realtime-api
npm.cmd run smoke:local
docker compose -f compose.local.yml stop
```

Không chạy `down -v` để giữ dữ liệu. Khi stop, worker ngừng nhận job, chờ I/O bounded, đóng broker/DB; lease còn dở tự hết hạn sau 60 giây nếu process bị kill. Expiry sweep chạy độc lập với lookup/ranking để HTTP chậm không trì hoãn đóng offer. Reservation ASSIGNMENT_PENDING không dùng deadline offer làm hạn giải phóng.

Outbox lỗi tự retry. Để requeue sớm một event chưa confirm: `npm.cmd run outbox:requeue -- <eventId>` với DATABASE_URL riêng Matching. Giữ event ID, payload, version và expiresAt. DLQ `driver.offers.dlq` là nơi giữ malformed hoặc retry hết 10 lần; kiểm tra/sửa nguyên nhân rồi dùng Rabbit management để chuyển lại `driver.offers`. Realtime truy vấn state nên message quá hạn/thu hồi không hiện lại.

OpenAPI: http://127.0.0.1:3007/openapi.json, Swagger: /docs (bật SWAGGER_ENABLED). Readiness API chỉ schema/DB; worker có probe nội bộ 3017. Quan sát backlog outbox, lease, tuổi job, offer pending, Rabbit DLQ và dependency error; không log JWT, GPS hoặc credentials.

## Gateway

Gateway đã proxy `/api/v1/matching/offers/**` sang Matching `/matching/offers/**`, giữ JWT/Idempotency-Key/X-Request-Id và chỉ cho DRIVER. Matching vẫn verify issuer/JWKS/audience. Backend mới đã smoke qua Gateway/User thật trên Docker/Kubernetes; [runbook](../../../docs/deploy-backend.md). Smoke trong Matching local cũ vẫn gọi REST trực tiếp. Internal routes không public.
