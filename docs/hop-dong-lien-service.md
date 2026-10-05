# Hợp đồng và số liệu liên service

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Toàn hệ thống |
| Rà soát | 2026-10-06 |
| Quy ước | [Format và số liệu](quy-uoc-tai-lieu.md) |

Đối chiếu source/lockfile/config và các stack local ngày 2026-10-06. Đây là bảng tham chiếu hiện tại; báo cáo feature cũ ghi số liệu tại thời điểm kiểm thử của feature đó.

## Runtime và cổng

| Service / process | Default runtime | Host trong Matching local | Công nghệ / nguồn |
| --- | --- | --- | --- |
| Gateway public / internal | 8080 / 8090 | Chưa chạy trong stack | Java 21, Spring Boot 4.1.1, Spring Cloud 2025.1.3; application.yaml/POM |
| User | 3011 | Chưa chạy; RIDER issuer là mock | Java 21, JDK HttpServer/JDBC; AppConfig/POM |
| Trip API | 3001 | 13001 | Node 24, TypeScript 5.9, NestJS 11; bootstrap/config.ts |
| Trip worker health | 3002 | Không publish | OUTBOX worker; bootstrap/config.ts |
| Driver | 3003 | 3008 | Node 24 trong stack, TypeScript/NestJS 11; configuration.ts |
| Routing | 3004 | 13004 | Node 24, TypeScript 5.9, NestJS 11; bootstrap/config.ts |
| Realtime | 3004 | 3009 | Node 24, TypeScript/NestJS 11, Socket.IO; configuration.ts |
| Price | 3005 | 13005 | Node 24, TypeScript 5.9, NestJS 11; bootstrap/config.ts |
| Matching API | 3007 | 3007 | Node 24, TypeScript 5.9, NestJS 11; bootstrap/config.ts |
| Matching worker health | 3017 | Không publish | worker.ts |
| OSRM ô tô | 5000 | 5000 | Backend riêng; graph car MLD Hà Nội |

Routing và Realtime cùng default 3004; Driver và Trip mock cùng default 3003. Khi chạy chung phải override. [Matching compose](../service/matching-service/compose.local.yml) dùng các cổng ở cột host; [Trip local](../service/trip-service/compose.local.yml) dùng Trip 3001, worker 3002, mock 3003, Routing 3004, Price 3005. Không ghép cổng của hai stack thành một cấu hình.

PostgreSQL test: Trip 55434, Matching 55435; Matching local DB 55436; Trip local DB 55433. Rabbit test 5673, Rabbit Matching local chỉ trong network Docker. Redis Matching local dùng DB index 1 Driver, 2 Realtime và không publish ra host. Các cổng test là cấu hình phiên validation, không phải default của PostgreSQL/RabbitMQ.

## Ngưỡng nghiệp vụ và kỹ thuật

| Chủ đề | Giá trị / đơn vị | Loại và nguồn |
| --- | --- | --- |
| Quote Trip | 300000 ms (5 phút) | Chính sách v1; EstimateTrip |
| Active Trip | Một chuyến / khách và một chuyến / tài xế | Domain + unique DB constraints Trip |
| Bán kính nearby | 2000 m (2 km) | Routing cố định; Realtime default/tối đa |
| GPS freshness | 30000 ms | Realtime default/tối đa; Matching lọc lại khi chọn |
| GPS future tolerance | 5000 ms | Default Realtime và filter Routing/Matching |
| Realtime result cap | 50 tài xế | NearbyPolicy.maximumResults; khác GEO scan cap 5000 |
| Routing matrix cap / batch | 50 / 25 ứng viên | Defaults config; ETA luôn driver → pickup |
| Routing deadline | 4000 ms | Cả lookup, queue, limiter, map và batches |
| Routing async workers | 2 | Cùng process, xử lý I/O; không phải worker threads |
| Routing Realtime lookup timeout | Default 1000 ms; Matching stack override 3000 ms | Luôn cắt theo deadline còn lại |
| Offer TTL | 20000 ms (20 giây) | Tính ở DB/server; retry/reconnect không reset |
| Search polling / expiry scan | 5000 ms / 1000 ms | Defaults Matching; không deadline kết thúc tìm xe |
| Matching concurrent jobs / lease | 2 / 60000 ms | Worker lease khác reservation; pending callback không hết theo TTL offer |
| Retry Matching | Nominal 1000–30000 ms, jitter hệ số 0.8–1.0 | Hiện code có thể bắt đầu ở 800 ms; không diễn giải thành deadline tìm xe |
| REST body cap Node/User | 65536 byte (64 KiB) | Routing/Matching/Trip/Price và User admission |
| Gateway body cap | 256 KiB | Cấu hình 256KB của Spring DataSize; service vẫn kiểm cap nhỏ hơn |

## Xe và bảng giá mẫu

Danh mục v1 liên thông mới: `BIKE`, `CAR_4`, `CAR_7`. Trip/Routing/Price còn cho phép `CAR` khi được cấu hình cho tương thích cũ; `MOCK_BIKE` chỉ trong profile/policy mock. Driver/Realtime/Matching không nhận mã legacy này. Quote/chuyến cũ giữ snapshot/giá, không tính lại; estimate mới cần danh mục của toàn luồng khớp nhau.

| Vehicle type | Mở cửa VND | Bao gồm m | Vượt VND/km | OSRM Hà Nội |
| --- | --- | --- | --- | --- |
| CAR_4 | 12000 | 1000 | 10000 | driving, graph car |
| CAR_7 | 12000 | 1000 | 10000 | driving, graph car |
| BIKE | 8000 | 1000 | 4000 | Chưa có profile motorbike; kiểm bằng mock |
| CAR legacy | 12000 | 1000 | 10000 | Mapping explicit khi cấu hình cho phép |

Nguồn: [policy Price](../service/price-service/config/fare-policy.example.json), [OSRM profiles](../service/routing-service/config/vehicle-profiles.osrm.json). Công thức `openingFareVnd + ceil(max(0,distanceMeters-includedDistanceMeters)*pricePerKmVnd/1000)`; không thu tiền theo durationSeconds trong v1. Ví dụ 2546 m CAR_4/CAR_7 = 27460 VND; fixture 4000 m = 42000 VND CAR, 20000 VND BIKE. Đây là giá mẫu, không phải biểu giá kinh doanh được duyệt.

## Contract và xác thực

| Luồng | Contract hiện có | Xác thực / lưu ý |
| --- | --- | --- |
| Trip → Routing | POST /internal/routes/estimate; data chỉ distanceMeters/durationSeconds | Credential Trip riêng |
| Trip → Price | POST /internal/fares/estimate | Credential Trip; tiền chuỗi VND |
| Trip → Matching | POST /internal/matching/requests, cancel, completion | Credential Trip; ACK 202 sau durable write |
| Matching → Routing | POST /routes/matrix; pickup/vehicleType | Credential Matching; không gửi candidate locations |
| Routing → Realtime | GET /internal/realtime/nearby-drivers | X-Service-Token; latitude/longitude/radiusMeters/vehicleType |
| Realtime → Driver | POST /internal/drivers/eligibility/batch | Credential Realtime riêng |
| Driver → Trip / Matching | POST /internal/trips/active-drivers/batch; POST /internal/matching/reservations/batch | Credential lookup Driver riêng; chỉ internal |
| Matching → Driver | GET /internal/drivers/:driverId/eligibility | Credential Matching; snapshot lấy server |
| Matching → Trip | POST /internal/trips/:id/assignment; GET /internal/trips/:id/matching-state | Matching callback token; assignment 202 sau commit |
| Driver REST → Matching | GET active/detail offer; POST accept/decline | JWT DRIVER, issuer/JWKS Driver, audience matching-service; decision có Idempotency-Key |
| Matching → Realtime | Rabbit DRIVER_TRIP_OFFER / UPDATED, đọc state Matching | Publisher confirms/manual ACK; WS driver.trip.offer / updated |

Driver JWT default audiences: driver-service,trip-service,realtime-service,matching-service. User `JWT_AUDIENCE` mặc định trống; khi tích hợp Trip phải cấu hình `trip-service`. Issuer/JWKS cần khớp deployment, không lấy mặc định placeholder làm cấu hình production.

Node business success `{data,meta:{requestId}}`, error `{error:{code,message},meta}`; details chỉ ở service hỗ trợ. User success body trần, error `{code,message,fieldErrors}`. Gateway giữ status/body upstream; lỗi do Gateway tạo dùng `{error,meta}`. Health/JWKS/OpenAPI không bắt buộc business envelope. X-Request-Id sai: Trip/Matching/Gateway reject; Driver/Realtime có thể sinh lại. Header thiếu thường được sinh mới; xem API từng service.

## Tích hợp Gateway và deployment hiện tại

- Gateway có `/api/v1/matching/offers/**` DRIVER-only và POST `/api/v1/routes`, `/api/v1/routes/recalculate` → Routing 3004 với server credential riêng. Không expose matrix/internal. User OTP/password-reset không còn whitelist.
- Trip replay header Idempotent-Replay được Gateway CORS expose cùng tên legacy. JWT/Idempotency-Key/requestId và upstream body/status được giữ.
- Stack backend mới dùng User issuer thật và Gateway Redis receiver thật. Docker :18080, Kubernetes chande-local qua port-forward :18081; cả hai đã smoke CAR_4/CAR_7. Xem [runbook](deploy-backend.md), [báo cáo](bao-cao-tich-hop-backend.md).
- Nginx public ingress chuyển /api/v1 và /ws vào Java Gateway, Engine.IO /socket.io vào Realtime namespace /realtime. Không dùng legacy location.update của /ws (chỉ logging) thay Socket.IO GPS/offer.
- Matching local cũ vẫn có RIDER/Gateway mock để chạy riêng; không đổi số/điều kiện của báo cáo đó thành kết quả backend mới. OTP Driver local còn mock; Notification target backend local dùng cùng Gateway receiver, không có push/SMS/email riêng. BIKE real, UI thiết bị và Internet/production chưa nghiệm thu.

Kết quả tests và các lỗi tài liệu đã sửa: [báo cáo validation](bao-cao-validation.md). Baseline kiểm tra source tự động: [contract-baseline.json](contract-baseline.json).
