# API Gateway

| Thuộc tính | Giá trị |
| --- | --- |
| Service | api-gateway |
| Rà soát | 2026-10-06 |
| Quy ước | [Format và số liệu](../../docs/quy-uoc-tai-lieu.md) |

Cổng vào duy nhất cho Customer App, Driver App và Web quản trị (sơ đồ C2). Gateway xác thực JWT, phân quyền
theo tài liệu từng service, định tuyến tới đúng service (có chia tải và failover), và giữ kết nối WebSocket để đẩy
trạng thái chuyến xuống app.

> Sơ đồ C2 ghi gateway dùng TypeScript/NestJS; nhóm đã chọn giữ Java Spring Boot 4 + Spring Cloud Gateway (WebMVC).
> Cần cập nhật nhãn công nghệ trên sơ đồ.

Gateway đã nối User/Driver/Trip/Matching và Routing 3004 với credential server. Nginx ingress chung đưa REST và /ws vào Gateway, Socket.IO /realtime vào Realtime. Backend Docker/Kubernetes local đã smoke qua User issuer/Gateway thật; [runbook](../../docs/deploy-backend.md), [báo cáo](../../docs/bao-cao-tich-hop-backend.md).

```text
App/Web ──REST /api/v1/**──▶ :8080  ┌─ xác thực JWT, phân quyền, rate limit
        ──WebSocket /ws────▶        ├─ /api/v1/auth, /users        ─▶ user-service (Customer Service)
                                    ├─ /api/v1/driver-auth, /drivers─▶ driver-service
                                    ├─ /api/v1/trips               ─▶ trip-service
                                    ├─ /api/v1/routes            ─▶ routing-service :3004 (token server)
                                    └─ /api/v1/matching/offers   ─▶ matching-service :3007
Trip ──POST /internal/events/trips─▶ :8090 (cổng nội bộ) ─▶ Redis ─▶ mọi instance gateway ─▶ WebSocket
```

## 1. Bảng định tuyến

Gateway bỏ `/api/v1` khi chuyển tiếp (`/api/v1/trips/active` → `/trips/active`), đúng quy ước trong 3 tài liệu API.

| Đường dẫn public | Service | Quyền |
| --- | --- | --- |
| `POST /api/v1/auth/{register, login, refresh, logout}` | user-service v2 | Ẩn danh |
| `POST /api/v1/auth/logout-all`, `/api/v1/users/**` | user-service | RIDER |
| `POST /api/v1/driver-auth/{otp/request, otp/verify, refresh, logout}` | driver-service | Ẩn danh |
| `/api/v1/drivers/**` | driver-service | DRIVER |
| `POST /api/v1/trips/estimate`, `POST /api/v1/trips` | trip-service | RIDER |
| `PATCH /api/v1/trips/{id}/status` | trip-service | DRIVER |
| `GET /api/v1/trips/{active, history, id}`, `POST /api/v1/trips/{id}/cancel` | trip-service | RIDER, DRIVER |
| `POST /api/v1/routes`, `/api/v1/routes/recalculate` | routing-service | RIDER, DRIVER; credential server |
| GET `/api/v1/matching/offers/active`, `/:offerId`; POST accept/decline | matching-service | DRIVER; ownership ở Matching |
| Mọi đường dẫn khác, kể cả `/internal/**` của service | — | Từ chối |

- Thêm service: thêm một khối trong `gateway.routing.services` (application.yaml). Gateway **dừng khởi động** nếu hai
  service khai báo đường dẫn chồng lấn, để không có request nào bị định tuyến nhầm.
- Header `Authorization`, `Idempotency-Key`, `X-Request-Id` được chuyển nguyên vẹn; `X-Service-Token` từ client bị xoá.
- Routing credential được inject từ ROUTING_GATEWAY_TOKEN, không từ client. Matrix/internal không public.
- `Location: /trips/<id>` của service được đổi thành `/api/v1/trips/<id>`.
- Endpoint ẩn danh bỏ qua Bearer token đã hết hạn (để app vẫn gọi được `/auth/refresh`, `/auth/logout`).

## 2. Chịu tải cao và nhiều instance

| Cơ chế | Tác dụng |
| --- | --- |
| Virtual thread (Tomcat) | Hàng nghìn request đang chờ service không làm cạn thread pool |
| HTTP/1.1 keep-alive, connect timeout 2s, timeout tổng 15s | Tái dùng kết nối; service treo không giữ request mãi |
| Bulkhead `max-concurrent-requests` mỗi service | Service chậm không kéo service khác chậm theo; vượt giới hạn trả `503` + `Retry-After: 1` ngay |
| Round-robin qua nhiều instance | `TRIP_SERVICE_URLS=http://trip-1:3001,http://trip-2:3001` |
| Failover | Instance không kết nối được bị bỏ qua 10s; request (kể cả POST, gửi lại đúng body) chuyển sang instance khác. Timeout khi đang chờ phản hồi **không** gửi lại vì service có thể đã xử lý — app retry với cùng `Idempotency-Key` |
| Chặn sớm | Sai token/quyền, body > 256KB, dò mật khẩu/OTP (5 lần/phút/IP/endpoint) bị chặn trước khi tới service |
| Nhiều instance gateway | Sự kiện chuyến đi qua Redis Stream nên app nối vào instance nào cũng nhận được |

Lỗi do Gateway tạo dùng envelope sau; body/status upstream giữ nguyên, gồm response body trần của User v2:
`{"error":{"code","message","details":[]},"meta":{"requestId"}}`. Mã riêng của gateway: `ENDPOINT_NOT_FOUND` (404),
`PAYLOAD_TOO_LARGE` (413), `GATEWAY_TIMEOUT` (504); `DEPENDENCY_UNAVAILABLE` (503) khi không gọi được service.

## 3. Xác thực JWT

Theo tài liệu User/Trip: JWT ký **RS256/ES256**, khoá công khai lấy từ JWKS (thay cho HS256 secret chung trước đây —
Trip không nhận HS256). Mỗi issuer chỉ được phát các role khai báo cho nó (issuer tài xế không thể phát token RIDER).
Chấp nhận `typ: at+jwt`; lệch đồng hồ tối đa 30 giây. JWKS được cache 5 phút, tải lại tối đa mỗi 30 giây khi gặp `kid` lạ.

## 4. WebSocket `/ws` — trip events

Các tài liệu ghi rõ tên sự kiện/room/ack của WebSocket chưa được chốt; đây là giao thức gateway đang cài đặt.

Giao thức auth/trip.event đã kiểm chứng trong smoke backend. GPS/offer dùng Realtime Socket.IO qua ingress /socket.io, namespace /realtime; legacy location.update của Gateway chỉ logging, không thay kênh GPS thật.

**Xác thực**: header `Authorization: Bearer <jwt>` lúc handshake (app mobile), hoặc tin nhắn đầu tiên
`{"type":"auth","token":"<jwt>"}` trong 10 giây (trình duyệt). Không đặt token trên URL.
Token hết hạn thì kết nối bị đóng; gửi lại `auth` với token mới (cùng người dùng) để gia hạn. Tối đa 5 kết nối/tài khoản.

| Hướng | Tin nhắn |
| --- | --- |
| App → GW | `{"type":"auth","token":"..."}` · `{"type":"ping"}` (mỗi ~25s) · `{"type":"location.update","lat":10.77,"lng":106.70,"heading":90,"speed":8.5,"accuracy":5,"recordedAt":"..."}` (chỉ DRIVER, tối đa 1 lần/giây) |
| GW → App | `{"type":"auth.ok","userId","role","expiresAt"}` · `{"type":"pong"}` · `{"type":"trip.event","event":{...envelope mục 12 tài liệu Trip...}}` · `{"type":"error","code","message"}` |

Mã đóng kết nối: `4401` (`UNAUTHENTICATED`, `AUTH_TIMEOUT`, `TOKEN_EXPIRED`, `IDENTITY_CHANGED`), `4429` (`TOO_MANY_CONNECTIONS`).
App phải bỏ qua `trip.event` có `tripVersion` nhỏ hơn bản đang hiển thị, và gọi `GET /api/v1/trips/active` sau khi kết nối lại.

## 5. Sự kiện chuyến từ Trip

`POST /internal/events/trips` trên **cổng nội bộ 8090** (cổng 8080 trả 404 cho `/internal/**`), header
`X-Service-Token`. Body là envelope mục 12 tài liệu Trip, kiểm tra chặt (sai/thừa trường → 400 kèm danh sách trường).

- `202` sau khi đã lưu vào Redis (không có nghĩa thiết bị đã nhận).
- Trùng `eventId` cùng nội dung → `202`, không đẩy lại. Trùng `eventId` khác nội dung → `409 EVENT_ID_REUSED`.
- Sự kiện có `tripVersion` ≤ bản đã đẩy → lưu nhưng không đẩy (tránh UI lùi trạng thái).
- Redis lỗi → `503`, Trip retry cùng `eventId`. REST không phụ thuộc Redis.

Production cần bật AOF cho Redis (`appendonly yes`) để "đã lưu" thật sự bền vững.

## 6. Cấu hình

| Biến môi trường | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `PORT` / `INTERNAL_PORT` | 8080 / 8090 | Cổng public / cổng nội bộ |
| `USER_SERVICE_URLS`, `DRIVER_SERVICE_URLS`, `TRIP_SERVICE_URLS`, `ROUTING_SERVICE_URLS` | localhost:3011 / 3003 / 3001 / 3004 | Danh sách instance, phân tách bằng dấu phẩy |
| `MATCHING_SERVICE_URLS`, `ROUTING_GATEWAY_TOKEN` | localhost:3007 / secret server | Matching proxy và scope Routing |
| `RIDER_JWT_ISSUER`, `RIDER_JWKS_URI` | `https://identity.example.invalid/rider`, `http://localhost:3011/.well-known/jwks.json` | Issuer token khách |
| `DRIVER_JWT_ISSUER`, `DRIVER_JWKS_URI` | `https://identity.example.invalid/driver`, `http://localhost:3003/.well-known/jwks.json` | Issuer token tài xế |
| `TRIP_SERVICE_TOKEN` | giá trị dev | Token Trip dùng gọi `/internal/events/trips` (≥ 32 ký tự, **đổi khi deploy**) |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | localhost, 6379 | Redis |
| `AUTH_MAX_ATTEMPTS` | 5 | Số lần thử đăng nhập/OTP mỗi phút mỗi IP |

Load balancer nên kiểm tra `GET /actuator/health/readiness` (không phụ thuộc Redis).

## 7. Chạy và kiểm thử

```bash
./mvnw spring-boot:run
./mvnw test
```

`RealtimeRedisIntegrationTest` cần Redis ở `localhost:6379`, không có thì tự bỏ qua; các test khác không cần service hay
Redis nào đang chạy.

Đợt tích hợp mới: 75 tests pass với Redis test riêng, Docker/Kubernetes smoke CAR_4/CAR_7 pass, restart giữ JWT/account. CORS expose Idempotent-Replay cùng tên legacy. [Báo cáo](../../docs/bao-cao-tich-hop-backend.md).

## 8. Cần nhóm chốt

1. Issuer/JWKS của Driver Service (hoặc dùng chung một Auth issuer) — đặt qua `DRIVER_JWT_ISSUER`, `DRIVER_JWKS_URI`.
2. Giao thức WebSocket ở mục 4 (tên tin nhắn, mã đóng, heartbeat).
3. Contract Gateway → Realtime Location (hiện `LoggingLocationForwarder` chỉ ghi log), Notification → Gateway.
4. Routing/Matching proxy và service scope đã nối; Web quản trị, UI thiết bị, TLS/HA và hosting production vẫn ngoài nghiệm thu local.
