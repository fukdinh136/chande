# API Gateway — tài liệu

| Thuộc tính | Giá trị |
| --- | --- |
| Service | api-gateway |
| Rà soát | 2026-10-06 |
| Quy ước | [Format và số liệu](../../../docs/quy-uoc-tai-lieu.md) |

> Cập nhật 06/10/2026, theo code nhánh `api-gateway` (commit `8e3ea97`).
> README trong `api-gateway/` là bản tóm tắt; tài liệu này mô tả đầy đủ hợp đồng và cách gateway hoạt động.

Checkout ở service/api-gateway. Routing 3004 /routes và /routes/recalculate đã proxy bằng credential server; Matching offers DRIVER-only đã nối. CORS expose Idempotent-Replay đúng Trip. Docker/Kubernetes backend đã smoke qua User/Gateway thật; [runbook](../../../docs/deploy-backend.md), [báo cáo](../../../docs/bao-cao-tich-hop-backend.md).

| Phần | Dành cho |
| --- | --- |
| A. Mục 1–6 | Người viết **app** (Customer App, Driver App, Web quản trị): gọi API, xử lý lỗi, WebSocket |
| B. Mục 7–8 | Người viết **service phía sau** (User, Driver, Trip, Routing): gateway gửi gì xuống, yêu cầu gì ở service |
| C. Mục 9–14 | Người **bảo trì và vận hành** gateway: kiến trúc, cấu hình, triển khai, kiểm thử, rủi ro |

---

## 0. Tổng quan

Gateway là cổng vào duy nhất từ Internet. Nó làm các việc sau:

- Kiểm JWT và phân quyền theo role.
- Giới hạn số lần thử đăng nhập/OTP.
- Định tuyến request tới đúng service, có chia tải và failover.
- Giữ kết nối WebSocket để đẩy trạng thái chuyến xuống app.

```text
App / Web ──REST /api/v1/**──▶ :8080 (public) ─┬─ /api/v1/auth/**, /users/**          ─▶ user-service   :3011
          ──WebSocket /ws────▶                 ├─ /api/v1/driver-auth/**, /drivers/** ─▶ driver-service :3003
                                               ├─ /api/v1/trips/**                    ─▶ trip-service   :3001
                                               ├─ POST /api/v1/routes               ─▶ routing-service:3004
                                               └─ /api/v1/matching/offers/**         ─▶ matching-service:3007

trip-service ──POST /internal/events/trips──▶ :8090 (nội bộ) ──▶ Redis Stream ──▶ mọi instance gateway ──▶ WebSocket
gateway ──GET /.well-known/jwks.json──▶ user-service, driver-service   (lấy public key để kiểm JWT)
```

| Hạng mục | Giá trị |
| --- | --- |
| Công nghệ | Java 21, Spring Boot 4.1.1, Spring Cloud 2025.1.3 (Gateway Server **WebMVC**), Spring Security OAuth2 Resource Server (Nimbus), Spring WebSocket (Tomcat), Spring Data Redis, Actuator |
| Luồng xử lý | Virtual thread cho request; HTTP client gọi service chạy trên platform thread (mục 9.3) |
| Cổng | `8080` public (REST + WebSocket), `8090` nội bộ (`/internal/**`) |
| Phụ thuộc ngoài | Redis (chỉ cho realtime); JWKS của User/Driver Service |

> Sơ đồ C2 ghi gateway dùng TypeScript/NestJS; nhóm đã chọn Java Spring Boot. Cần sửa nhãn trên sơ đồ.

---

## A. Dành cho app

## 1. Quy ước chung

- **Base URL**: `https://<gateway>` (local: `http://localhost:8080`). Mọi API REST có prefix **`/api/v1`**. Gateway bỏ prefix này khi chuyển tiếp: `/api/v1/trips/active` tới trip-service thành `/trips/active`.
- **Header client gửi**:

  | Header | Bắt buộc | Ghi chú |
  |---|---|---|
  | `Authorization: Bearer <access JWT>` | Với route có role | Route ẩn danh **bỏ qua** header này, nên gửi kèm token đã hết hạn cũng không sao |
  | `Content-Type: application/json` | Khi có body | Gateway không kiểm tra; service kiểm tra |
  | `X-Request-Id: <UUID>` | Không | Thiếu thì gateway sinh mới; **sai định dạng hoặc gửi 2 lần thì 400** |
  | `Idempotency-Key: <UUID>` | Theo tài liệu từng service | Gateway chuyển nguyên vẹn |

- **Header gateway luôn trả về**: `X-Request-Id`. Giá trị bằng header client gửi, hoặc là giá trị gateway sinh. Gateway luôn tự đặt header này và xoá bản do service đặt.
- **Body**: tối đa **256 KB**; vượt thì 413 `PAYLOAD_TOO_LARGE`.
- **CORS** (chỉ cho `/api/**`):

  | Thuộc tính | Giá trị |
  |---|---|
  | Origin | Theo danh sách `cors.allowed-origins`; local: `http://localhost:5500`, `http://127.0.0.1:5500` |
  | Method | `GET, POST, PUT, PATCH, DELETE, OPTIONS` |
  | Header client được gửi | `Authorization, Content-Type, Idempotency-Key, X-Request-Id` |
  | Header client được đọc | `X-Request-Id, Idempotent-Replay, Idempotency-Replayed, Retry-After, Location` |
  | Credentials | Không cho phép |
  | Cache preflight | 1 giờ |

  App mobile không gửi `Origin` nên không bị ảnh hưởng.
- **Header `Location`** dạng tương đối (`/trips/<id>`) được gateway đổi thành `/api/v1/trips/<id>`.

## 2. Bảng định tuyến và quyền

| Đường dẫn public | Service | Quyền tại gateway |
| --- | --- | --- |
| `POST /api/v1/auth/register` | user-service | Ẩn danh, có rate limit |
| `POST /api/v1/auth/login` | user-service | Ẩn danh, có rate limit |
| `POST /api/v1/auth/refresh` | user-service | Ẩn danh |
| `POST /api/v1/auth/logout` | user-service | Ẩn danh |
| `POST /api/v1/auth/logout-all` | user-service | RIDER |
| `/api/v1/users/**` (mọi method) | user-service | RIDER |
| `POST /api/v1/driver-auth/otp/request` | driver-service | Ẩn danh, có rate limit |
| `POST /api/v1/driver-auth/otp/verify` | driver-service | Ẩn danh, có rate limit |
| `POST /api/v1/driver-auth/refresh` | driver-service | Ẩn danh |
| `POST /api/v1/driver-auth/logout` | driver-service | Ẩn danh |
| `/api/v1/drivers/**` | driver-service | DRIVER |
| `POST /api/v1/trips/estimate`, `POST /api/v1/trips` | trip-service | RIDER |
| `PATCH /api/v1/trips/{id}/status` | trip-service | DRIVER |
| Mọi request khác dưới `/api/v1/trips/**` (`GET active`, `GET history`, `GET {id}`, `POST {id}/cancel`…) | trip-service | RIDER hoặc DRIVER |
| POST `/api/v1/routes`, `/api/v1/routes/recalculate` | routing-service | RIDER hoặc DRIVER; server credential |
| GET `/api/v1/matching/offers/active`, `/:offerId`; POST accept/decline | matching-service | DRIVER; ownership ở Matching |
| `GET /ws` | gateway (WebSocket, mục 6) | Xác thực trong kết nối |
| **Mọi đường dẫn khác** | — | **Từ chối** |

Hành vi khi bị từ chối:

- Đường dẫn không có trong bảng (kể cả `/api/v1/internal/**`, hay `GET /api/v1/auth/login`):
  - không có token thì **401** `UNAUTHENTICATED`;
  - có token hợp lệ thì **403** `FORBIDDEN_ACTION`.

  Gateway **không** trả 404 cho các đường dẫn này.
- Gateway chỉ phân quyền **thô** theo đường dẫn và role. Service vẫn phải tự kiểm tra quyền chi tiết (ví dụ khách chỉ xem chuyến của mình) và tự trả 404/405 cho method hoặc đường dẫn con không tồn tại.
- Whitelist khớp User v2 và Driver; đã bỏ OTP/password-reset của User 0.1 chưa có runtime. [User v2](../../user-service/docs/user-service-v2.md).

## 3. Token được gateway chấp nhận

| Kiểm tra | Quy tắc |
| --- | --- |
| Thuật toán | Chỉ **RS256** hoặc **ES256**. Từ chối HS256 và token không ký (`alg: none`) |
| Issuer (`iss`) | Phải trùng **tuyệt đối** một issuer đã cấu hình. Issuer lạ hoặc thiếu `iss` thì 401. Gateway **không** tải JWKS theo URL nằm trong token |
| Chữ ký | Kiểm bằng public key lấy từ JWKS **của đúng issuer đó**; token ký bằng khoá của issuer khác thì 401 |
| `typ` (header) | `JWT`, `at+jwt`, `application/at+jwt`, hoặc không có |
| `exp` | Bắt buộc; cho lệch đồng hồ **30 giây** (áp dụng cho cả `nbf` nếu có) |
| `sub` | Bắt buộc là UUID (36 ký tự) |
| `role` | Phải thuộc danh sách role của issuer. Issuer tài xế không phát được token `RIDER` và ngược lại |
| `aud` | Chỉ kiểm khi cấu hình `audiences` cho issuer; hiện **không** cấu hình |

Issuer cấu hình mặc định:

| Issuer (biến môi trường) | JWKS | Role được phát |
| --- | --- | --- |
| `RIDER_JWT_ISSUER` (mặc định `https://identity.example.invalid/rider`) | `RIDER_JWKS_URI` (mặc định `http://localhost:3011/.well-known/jwks.json`) | `RIDER` |
| `DRIVER_JWT_ISSUER` (mặc định `https://identity.example.invalid/driver`) | `DRIVER_JWKS_URI` (mặc định `http://localhost:3003/.well-known/jwks.json`) | `DRIVER` |

## 4. Lỗi do gateway trả

Envelope của lỗi do Gateway tạo; response upstream giữ nguyên. User v2 dùng body trần/lỗi fieldErrors, các service Node dùng data/error envelope:

```json
{
  "error": { "code": "UNAUTHENTICATED", "message": "Bạn cần đăng nhập hoặc token không hợp lệ", "details": [] },
  "meta":  { "requestId": "90000000-0000-4000-8000-000000000001" }
}
```

- `details` là mảng `{ "field": "...", "reason": "..." }`, không bao giờ chứa lại giá trị client gửi lên.
- Lỗi gateway luôn có `Content-Type: application/json`, `Cache-Control: no-store` và `X-Request-Id`.
- Lỗi 401 có thêm `WWW-Authenticate: Bearer`.

| Code | HTTP | Khi nào | Header thêm |
| --- | --- | --- | --- |
| `INVALID_REQUEST` | 400 | `X-Request-Id` sai định dạng hoặc gửi 2 lần; body sự kiện nội bộ sai (mục 8) | — |
| `UNAUTHENTICATED` | 401 | Thiếu token ở route cần role; token sai, hết hạn, issuer lạ; đường dẫn không được phép khi chưa có token | `WWW-Authenticate: Bearer` |
| `INVALID_SERVICE_CREDENTIAL` | 401 | Endpoint nội bộ: thiếu hoặc sai `X-Service-Token` | — |
| `FORBIDDEN_ACTION` | 403 | Sai role; đường dẫn không được phép khi đã có token | — |
| `ENDPOINT_NOT_FOUND` | 404 | Gọi `/internal/**` trên cổng public, hoặc gọi API thường trên cổng nội bộ | — |
| `EVENT_ID_REUSED` | 409 | Sự kiện nội bộ trùng `eventId` nhưng khác nội dung | — |
| `PAYLOAD_TOO_LARGE` | 413 | Body > 256 KB | — |
| `RATE_LIMITED` | 429 | Vượt giới hạn thử đăng nhập/OTP (mục 5) | `Retry-After: <giây>` |
| `INTERNAL_ERROR` | 500 | Lỗi không lường trước trong gateway | — |
| `DEPENDENCY_UNAVAILABLE` | 503 | Không kết nối được service sau khi đã failover; service đứt kết nối giữa chừng; service quá tải ở gateway (bulkhead); Redis lỗi | `Retry-After: 1` khi do bulkhead |
| `GATEWAY_TIMEOUT` | 504 | Service không trả lời trong 15 giây | — |

**Lỗi do service trả về được chuyển nguyên vẹn**, giữ nguyên status, header và body. App sẽ gặp cả lỗi của gateway lẫn lỗi của service. Nếu service không dùng envelope `{error, meta}` (ví dụ user-service hiện tại trả `{code, message, fieldErrors}`), app phải xử lý được cả hai dạng.

**App nên retry thế nào:**

- `503` thì retry sau `Retry-After` (nếu có).
- `504` thì service **có thể đã xử lý xong**. Chỉ retry với **cùng `Idempotency-Key`**; với route không có idempotency thì đọc lại trạng thái trước khi gửi lại.

## 5. Giới hạn số lần thử (rate limit)

| Thuộc tính | Giá trị |
| --- | --- |
| Áp dụng cho | `POST` tới 4 endpoint register/login User và OTP request/verify Driver |
| Ngân sách | **5 request / 1 phút** (cửa sổ trượt) cho **mỗi cặp (endpoint, IP)**. Đếm **mọi** request, kể cả thành công |
| Vượt ngưỡng | 429 `RATE_LIMITED` + `Retry-After` (số giây tới khi có lại một lượt) |
| Thứ tự | Chạy **trước** bước kiểm JWT |

Đây là lớp chặn thô theo IP. User/Driver Service vẫn tự giới hạn theo tài khoản.
Xem thêm mục 13: ghi chú về IP sau load balancer và trường hợp chạy nhiều instance.

## 6. WebSocket `/ws`

> Giao thức này do gateway **đề xuất**; các tài liệu service ghi rõ tên sự kiện và cách ack chưa được nhóm chốt.

**Kết nối:** `ws(s)://<gateway>/ws` trên cổng public.

- Trình duyệt chỉ kết nối được từ origin nằm trong danh sách CORS.
- App mobile (không gửi `Origin`) luôn được nhận.

**Xác thực**, chọn một trong hai cách. **Không** đặt token trên URL.

1. **App mobile**: gửi header `Authorization: Bearer <jwt>` khi handshake. Token sai thì handshake bị từ chối với 401. Token đúng thì nhận ngay `auth.ok`.
2. **Trình duyệt** (không đặt được header): tin nhắn đầu tiên là `{"type":"auth","token":"<jwt>"}`, phải gửi trong vòng **10 giây**.

Chỉ chấp nhận token có `role` là `RIDER` hoặc `DRIVER`, và kiểm bằng cùng quy tắc ở mục 3.

**Tin nhắn app → gateway**

| `type` | Nội dung | Ghi chú |
| --- | --- | --- |
| `auth` | `{"type":"auth","token":"<jwt>"}` | Gửi lần đầu để xác thực, hoặc gửi lại với token mới để **gia hạn**. Token mới phải cùng `role` và cùng `sub` |
| `ping` | `{"type":"ping"}` | Gửi mỗi khoảng 25 giây; kết nối im lặng quá **60 giây** sẽ bị đóng |
| `location.update` | `{"type":"location.update","lat":10.77,"lng":106.70,"heading":90,"speed":8.5,"accuracy":5,"recordedAt":"2026-10-05T02:00:00Z"}` | **Chỉ DRIVER.** Xem chi tiết bên dưới |

Quy tắc của `location.update`:

- `lat` ∈ [−90, 90] và `lng` ∈ [−180, 180] là bắt buộc.
- `heading` ∈ [0, 360], `speed` ≥ 0, `accuracy` ≥ 0 là tuỳ chọn; `recordedAt` là chuỗi ISO 8601, tuỳ chọn.
- Gửi dày hơn **1 lần/giây** thì gateway lặng lẽ bỏ bớt, không báo lỗi.
- Thành công không có ack.
- Không gửi `driverId` trong tin nhắn; gateway lấy danh tính từ JWT.

**Tin nhắn gateway → app**

| `type` | Nội dung |
| --- | --- |
| `auth.ok` | `{"type":"auth.ok","userId":"<uuid>","role":"RIDER","expiresAt":"<ISO 8601>"}` |
| `pong` | `{"type":"pong"}` |
| `trip.event` | `{"type":"trip.event","event":{ "schemaVersion":1, "eventId", "type", "tripId", "tripVersion", "occurredAt", "data":{"riderId","driverId","status"} }}`. Được đẩy tới khách và tài xế của chuyến |
| `error` | `{"type":"error","code":"INVALID_REQUEST","message":"lat không hợp lệ"}`. Kết nối **không** bị đóng |

Các trường hợp gateway gửi `error` (kết nối không bị đóng):

| `code` | Khi nào |
| --- | --- |
| `INVALID_REQUEST` | Tin nhắn không phải JSON; `type` lạ; trường vị trí sai |
| `UNAUTHENTICATED` | Gửi vị trí trước khi xác thực |
| `FORBIDDEN_ACTION` | RIDER gửi vị trí |

**Mã đóng kết nối**

| Code | Reason | Khi nào |
| --- | --- | --- |
| 4401 | `AUTH_TIMEOUT` | Không xác thực trong 10 giây |
| 4401 | `UNAUTHENTICATED` | Token sai, role không hợp lệ, hoặc tin nhắn `auth` thiếu `token` |
| 4401 | `TOKEN_EXPIRED` | Quá `exp` + 30 giây mà chưa gia hạn. Gateway kiểm mỗi 5 giây |
| 4401 | `IDENTITY_CHANGED` | Gửi `auth` với token của người khác |
| 4429 | `TOO_MANY_CONNECTIONS` | Đã có **5** kết nối cùng tài khoản |

Ngoài ra kết nối còn bị đóng khi:

- tin nhắn vượt **8 KB**;
- client đọc quá chậm: một lần gửi không xong trong 5 giây, hoặc hàng đợi gửi vượt 64 KB.

**App phải làm:**

- Gia hạn bằng `auth` trước khi access token hết hạn.
- **Bỏ qua** `trip.event` có `tripVersion` nhỏ hơn bản đang hiển thị.
- Sau mỗi lần kết nối lại, gọi `GET /api/v1/trips/active` để đồng bộ. Gateway **không** gửi lại sự kiện phát ra lúc app mất kết nối.

---

## B. Dành cho service phía sau

## 7. Hợp đồng gateway → service

### 7.1 Gateway gửi gì xuống

| Hạng mục | Hành vi |
| --- | --- |
| Đường dẫn | Bỏ `/api/v1`: `/api/v1/users/me` → `/users/me`. Query string giữ nguyên |
| Method, body | Giữ nguyên. Body đã được đọc trước vào bộ nhớ (≤ 256 KB) để gửi lại được khi failover |
| `Authorization` | **Chuyển nguyên vẹn**, kể cả ở route ẩn danh (token có thể đã hết hạn) |
| `X-Request-Id` | Luôn có (UUID); gateway sinh nếu client không gửi |
| `Idempotency-Key` và header khác | Chuyển nguyên vẹn |
| `X-Service-Token` | **Bị xoá**, để client không giả danh service được |
| Danh tính người dùng | Gateway **không** thêm header kiểu `X-User-Id`. Service tự đọc `sub` và `role` từ JWT |

### 7.2 Gateway sửa gì trong response

- Đổi `Location: /xxx` thành `/api/v1/xxx`; URL tuyệt đối thì giữ nguyên.
- **Xoá** mọi header `Access-Control-*` và `X-Request-Id` do service đặt; gateway tự đặt lại. Service **không** cần, và không nên, xử lý CORS.
- Status, body và các header khác giữ nguyên. Gateway **không** đi theo redirect.

### 7.3 Timeout, chia tải, failover, bulkhead

| Cơ chế | Giá trị | Ý nghĩa với service |
| --- | --- | --- |
| Connect timeout | 2 giây | Không kết nối được thì coi như instance chết |
| Thời gian chờ phản hồi | 15 giây (tính cả đọc body) | Quá hạn thì client nhận 504; nếu đang đọc dở body thì nhận 503 |
| Chia tải | Round-robin giữa các instance trong `*_SERVICE_URLS` | Service phải **stateless**, hoặc dùng chung state |
| Failover | **Chỉ** khi không kết nối được (request chắc chắn chưa tới service): gửi lại **cùng body** sang instance khác, tối đa `min(3, số instance)` lần. Instance lỗi bị bỏ qua **10 giây**; nếu mọi instance đều đang bị bỏ qua thì vẫn thử | Service **có thể** nhận lại một POST bị gửi lại, nhưng chỉ khi lần trước chưa tới được service |
| Không failover | Khi đã gửi xong mà timeout, khi service trả lỗi 5xx, khi đứt kết nối giữa chừng | Gateway không retry; client tự retry. Endpoint ghi dữ liệu nên hỗ trợ `Idempotency-Key` |
| Bulkhead | Tối đa **256** request đang chờ cho mỗi service (routing-service: 128) | Vượt thì gateway trả 503 + `Retry-After: 1` ngay, không gửi xuống service |

### 7.4 Yêu cầu với service phát JWT (User, Driver)

- Ký **RS256 hoặc ES256**, header có `kid`, và công khai public key tại `GET /.well-known/jwks.json` (chỉ public key).
- Claim bắt buộc:
  - `iss`: trùng tuyệt đối giá trị cấu hình ở gateway;
  - `sub`: UUID;
  - `role`: `RIDER` hoặc `DRIVER`;
  - `exp`.
- `typ` là `JWT` hoặc `at+jwt`.
- Gateway cache JWKS **5 phút**. Gặp `kid` lạ thì tải lại, nhưng tối đa mỗi **30 giây** một lần. Nếu JWKS không truy cập được, gateway vẫn dùng khoá đã cache thêm **30 phút**.
  Hệ quả khi xoay khoá: phải giữ public key cũ trong JWKS ít nhất `access TTL + 30 giây + 5 phút` sau lần ký cuối cùng bằng khoá đó.
- JWKS được tải **khi có request đầu tiên cần xác thực**, không phải lúc gateway khởi động. Giới hạn của lần tải: connect 2 giây, read 3 giây, kích thước 256 KB.
- **Service vẫn phải tự kiểm JWT.** Service có thể bị gọi thẳng trong mạng nội bộ, và gateway không kiểm `aud`.

### 7.5 Endpoint nội bộ của service

Gateway **không bao giờ** public `/internal/**` của service: cấu hình route có path `/internal` thì gateway dừng khởi động, còn `/api/v1/internal/...` thì bị từ chối. Service gọi nhau trực tiếp trong mạng nội bộ, không đi qua gateway.

## 8. API nội bộ của gateway: nhận sự kiện chuyến

### `POST /internal/events/trips`

| Thuộc tính | Giá trị |
| --- | --- |
| Cổng | **Chỉ 8090** (gọi qua 8080 thì 404) |
| Xác thực | Header `X-Service-Token`, so khớp với token của `trip-service` trong cấu hình (so thời gian hằng, mỗi caller một token riêng). JWT người dùng **không** thay được token này |
| Content-Type | `application/json`; sai thì 400 `INVALID_REQUEST` |
| Body | Envelope sự kiện ở mục 12 tài liệu Trip, `schemaVersion` 1. Kiểm **chặt**: thiếu trường, sai kiểu, hoặc có **trường lạ** đều bị từ chối |

```json
{
  "schemaVersion": 1,
  "eventId": "60000000-0000-4000-8000-000000000002",
  "type": "trip.assigned",
  "tripId": "20000000-0000-4000-8000-000000000001",
  "tripVersion": 2,
  "occurredAt": "2026-10-05T02:02:00Z",
  "data": {
    "riderId": "30000000-0000-4000-8000-000000000001",
    "driverId": "40000000-0000-4000-8000-000000000001",
    "status": "ASSIGNED"
  }
}
```

| Trường | Quy tắc |
| --- | --- |
| `schemaVersion` | Số nguyên, bằng `1` |
| `eventId`, `tripId`, `data.riderId` | UUID |
| `type` → `data.status` | `trip.searching`→`SEARCHING`, `trip.assigned`→`ASSIGNED`, `trip.driver_arrived`→`DRIVER_ARRIVED`, `trip.started`→`IN_PROGRESS`, `trip.completed`→`COMPLETED`, `trip.cancelled`→`CANCELLED`. `status` phải khớp `type` |
| `tripVersion` | Số nguyên ≥ 1 |
| `occurredAt` | Chuỗi thời gian ISO 8601 dạng instant, ví dụ `2026-10-05T02:02:00Z` |
| `data.driverId` | UUID hoặc `null`. **Bắt buộc** với `assigned`, `driver_arrived`, `started`, `completed` |

**Kết quả**

| Trường hợp | HTTP | Đẩy xuống app? |
| --- | --- | --- |
| Sự kiện mới, `tripVersion` lớn hơn bản đã đẩy | 202 | Có |
| Trùng `eventId`, **cùng** nội dung (Trip retry) | 202 | Không đẩy lại |
| `tripVersion` ≤ bản đã đẩy của chuyến (đến trễ, sai thứ tự) | 202 | Không. Vẫn ghi receipt để lần retry sau nhận 202 |
| Trùng `eventId`, **khác** nội dung | 409 `EVENT_ID_REUSED` | — |
| Body sai | 400 `INVALID_REQUEST`, có `details` liệt kê **mọi** trường lỗi, ví dụ `{"field":"data.riderId","reason":"phải là UUID"}` | — |
| Thiếu hoặc sai token | 401 `INVALID_SERVICE_CREDENTIAL` | — |
| Redis lỗi | 503 `DEPENDENCY_UNAVAILABLE` | Trip retry **cùng `eventId`** |

Response 202 (`Cache-Control: no-store`):

```json
{ "data": { "eventId": "60000000-0000-4000-8000-000000000002", "accepted": true }, "meta": { "requestId": "<uuid>" } }
```

- 202 nghĩa là gateway **đã lưu** sự kiện vào Redis, **không** có nghĩa thiết bị đã nhận.
- "Cùng nội dung" được so trên JSON đã chuẩn hoá. Ví dụ `02:02:00Z` và `02:02:00.000Z` được coi là giống nhau.
- Mỗi `eventId` được nhớ **7 ngày**.
- Gọi `/internal/**` khác bằng token hợp lệ thì 403 `FORBIDDEN_ACTION`; không có token thì 401.

---

## C. Bảo trì và vận hành

## 9. Kiến trúc bên trong

### 9.1 Đường đi của một request

```text
Tomcat (virtual thread)
 │
 ├─ 1. RequestIdFilter        X-Request-Id: giữ / sinh / 400; đặt vào MDC để ghi log
 ├─ 2. InternalPortFilter     /internal/** chỉ trên 8090, API khác chỉ trên 8080 (health có ở cả hai) → 404
 ├─ 3. Spring Security
 │     ├─ chain #1 /internal/**  ServiceTokenAuthenticationFilter → chỉ trip-service được POST /internal/events/trips
 │     └─ chain #2 còn lại       CORS → AuthRateLimitFilter → BearerTokenAuthenticationFilter (IssuerRoutingJwtDecoder)
 │                               → AuthorizationFilter (bảng quyền mục 2, còn lại denyAll)
 ├─ 4. CachedBodyFilter       (/api/*, /internal/*) đọc body ≤ 256KB vào bộ nhớ → 413
 └─ 5. DispatcherServlet
       ├─ Route Spring Cloud Gateway: stripPrefix(2) → xoá X-Service-Token → UpstreamFilter
       │      (bulkhead → round-robin → failover) → JDK HttpClient → service
       │      → sửa Location → xoá Access-Control-* / X-Request-Id của service
       ├─ TripEventController   POST /internal/events/trips → TripEventParser → RedisTripEventInbox (Lua)
       └─ WebSocket handshake   /ws → RealtimeWebSocketHandler

Mọi exception → GatewayExceptionResolver → envelope lỗi (mục 4)
```

Request bị chặn ở bước 2–3 **không bị đọc body** và không chạm tới service.

### 9.2 Các package

| Package | Lớp chính | Trách nhiệm |
| --- | --- | --- |
| `routing` | `RoutingProperties`, `GatewayRoutesConfig`, `UpstreamFilter`, `ServiceInstanceSelector`, `RouteConflictChecker`, `HttpClientConfig`, `ApiPaths` | Sinh route từ cấu hình, chia tải, failover, bulkhead, HTTP client |
| `security` | `SecurityConfig`, `PublicEndpoints`, `IssuerRoutingJwtDecoder`, `JwtConfig`, `JwtProperties`, `CorsConfig`, `JsonSecurityErrorHandler`, `InternalSecurityErrorHandler` | Hai security chain, kiểm JWT nhiều issuer, bảng quyền, CORS |
| `internal` | `InternalApiProperties`, `InternalPortConfig`, `InternalPortFilter`, `ServiceTokenAuthenticationFilter` | Cổng nội bộ 8090, xác thực service bằng token |
| `ratelimit` | `AuthRateLimitFilter`, `SlidingWindowRateLimiter`, `AuthRateLimitProperties` | Giới hạn thử đăng nhập/OTP theo IP |
| `realtime` | `RealtimeWebSocketHandler`, `SessionRegistry`, `TripEventController`, `TripEventParser`, `RedisTripEventInbox`, `TripEventStreamListener`, `LocationForwarder` | WebSocket, nhận và phát sự kiện chuyến, vị trí tài xế |
| `web` | `RequestIdFilter`, `CachedBodyFilter`, `WebFilterConfig` | Request ID, đọc trước body, thứ tự filter |
| `error` | `ErrorCode`, `GatewayException`, `GatewayExceptionResolver`, `ErrorResponseWriter` | Phân loại exception và ghi envelope lỗi |

### 9.3 Một số quyết định kỹ thuật

- **HTTP client gọi service** là JDK `HttpClient` (HTTP/1.1 keep-alive), chạy trên **platform thread**. Trên JDK 21, `HttpClient` dùng `synchronized` nên làm virtual thread bị "pin"; nhóm đã tái hiện được việc gateway treo dưới tải cao. Request của client vẫn chạy trên virtual thread.
- **Matcher đường dẫn**: phân quyền, rate limit và route đều dùng `PathPattern` của Spring. Nhờ vậy dạng percent-encoding như `/auth/%6cogin` không lách được rate limit hay phân quyền.
- **Route chồng lấn**: hai service khai báo đường dẫn giao nhau (ví dụ `/trips/**` và `/trips/active`) thì gateway **dừng khởi động**.
- **Lỗi giữa chừng**: nếu proxy đã chép status/header của service rồi mới đứt, `GatewayExceptionResolver` xoá phần đã chép (giữ `X-Request-Id`, `Vary`, header CORS) rồi ghi lỗi gateway.

### 9.4 Realtime với Redis

| Key Redis | Nội dung | TTL |
| --- | --- | --- |
| `gw:trip-event:<eventId>` | SHA-256 của JSON sự kiện đã chuẩn hoá (receipt chống trùng) | 7 ngày |
| `gw:trip-version:<tripId>` | `tripVersion` lớn nhất đã phát | 7 ngày |
| `gw:trip-events` | Redis Stream, mỗi bản ghi gồm `event` (JSON), `rider`, `driver` | `MAXLEN ~ 100000` |

- `redis/store-trip-event.lua` làm **nguyên tử** cả 3 bước: kiểm receipt → kiểm version → `XADD`.
- Mỗi instance gateway có một virtual thread (`TripEventStreamListener`) chạy `XREAD BLOCK 1s` (100 bản ghi mỗi lần) và đẩy sự kiện tới các kết nối **trên chính instance đó**. Khoá kết nối là `RIDER:<riderId>` và `DRIVER:<driverId>`.
- Khi khởi động, listener đọc từ bản ghi **mới nhất** (không phát lại sự kiện cũ). Mất Redis thì thử lại với thời gian chờ tăng dần 0,5 giây → 30 giây, rồi đọc tiếp từ ID cuối đã đọc.
- REST không phụ thuộc Redis.
- Vị trí tài xế hiện chỉ được ghi log (`LoggingLocationForwarder`, mức debug). Khi có contract với Realtime Location service thì thay bằng một bean `LocationForwarder` khác.

## 10. Cấu hình

### 10.1 Biến môi trường

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `PORT` | `8080` | Cổng public |
| `INTERNAL_PORT` | `8090` | Cổng nội bộ |
| `USER_SERVICE_URLS` | `http://localhost:3011` | Danh sách instance, phân tách bằng dấu phẩy |
| `DRIVER_SERVICE_URLS` | `http://localhost:3003` | |
| `TRIP_SERVICE_URLS` | `http://localhost:3001` | |
| `ROUTING_SERVICE_URLS` | `http://localhost:3004` | Chỉ /routes và /routes/recalculate |
| `MATCHING_SERVICE_URLS` | `http://localhost:3007` | Offers public DRIVER-only |
| `ROUTING_GATEWAY_TOKEN` | Secret server | Inject sau khi xóa X-Service-Token client; không public matrix/internal |
| `RIDER_JWT_ISSUER`, `RIDER_JWKS_URI` | `https://identity.example.invalid/rider`, `http://localhost:3011/.well-known/jwks.json` | Phải khớp cấu hình JWT của user-service |
| `DRIVER_JWT_ISSUER`, `DRIVER_JWKS_URI` | `https://identity.example.invalid/driver`, `http://localhost:3003/.well-known/jwks.json` | |
| `TRIP_SERVICE_TOKEN` | giá trị dev | ≥ 32 ký tự, **bắt buộc đổi khi deploy** |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | `localhost`, `6379`, trống | Timeout lệnh và kết nối 2 giây |
| `AUTH_MAX_ATTEMPTS` | `5` | Số lần thử mỗi cửa sổ |

### 10.2 Thuộc tính trong `application.yaml`

| Thuộc tính | Mặc định | Ghi chú |
| --- | --- | --- |
| `gateway.routing.max-request-body-size` | `256KB` | |
| `gateway.routing.connect-timeout` / `read-timeout` | `2s` / `15s` | |
| `gateway.routing.failover.max-attempts` / `unavailable-cooldown` | `3` / `10s` | |
| `gateway.routing.services.<id>.instances` / `paths` / `max-concurrent-requests` | — / — / `256` | Path viết **sau** `/api/v1` |
| `gateway.internal.port` / `callers.<service>` | `8090` / — | Mỗi caller một token |
| `gateway.realtime.auth-timeout` / `idle-timeout` | `10s` / `60s` | |
| `gateway.realtime.max-sessions-per-user` / `location-min-interval` | `5` / `1s` | |
| `gateway.realtime.max-message-size` | `8KB` | |
| `gateway.realtime.event-retention` / `stream-max-length` | `7d` / `100000` | |
| `jwt.clock-skew` | `30s` | |
| `jwt.issuers[].issuer` / `jwk-set-uri` / `roles` / `audiences` | — | `audiences` để trống thì không kiểm `aud` |
| `cors.allowed-origins` | `http://localhost:5500`, `http://127.0.0.1:5500` | Không cho phép `*` |
| `rate-limit.auth.max-attempts` / `window` | `5` / `1m` | |
| `server.shutdown` / `spring.lifecycle.timeout-per-shutdown-phase` | `graceful` / `20s` | |
| `server.tomcat.accept-count` / `connection-timeout` | `500` / `10s` | |

**Thêm một service mới:** thêm một khối trong `gateway.routing.services`, rồi thêm quy tắc quyền tương ứng trong `SecurityConfig`. Nếu thiếu quy tắc quyền, route mới sẽ rơi vào `denyAll`.

### 10.3 Kiểm tra lúc khởi động (sai thì dừng)

- **Routing**:
  - Phải có ít nhất một service; mỗi service có ít nhất một instance và một path.
  - Instance có dạng `http(s)://host:port`, không có đường dẫn hay query.
  - Path bắt đầu bằng `/`, không có prefix `/api/v1`, không phải `/internal…`.
  - `max-concurrent-requests` ≥ 1 và `max-attempts` ≥ 1.
  - Không có route chồng lấn giữa các service.
- **Nội bộ**: cổng hợp lệ; có ít nhất một caller; token mỗi caller ≥ 32 ký tự và không trùng nhau.
- **JWT**: có ít nhất một issuer; issuer không trùng; `jwk-set-uri` là http(s); `roles` không rỗng.
- **CORS**: danh sách không rỗng và không có `*`.
- **Rate limit**: `max-attempts` ≥ 1, `window` > 0.
- **Realtime**: `max-sessions-per-user` ≥ 1; `event-retention` ≥ 1 giây; `stream-max-length` ≥ 1.

## 11. Triển khai

| Việc | Ghi chú |
| --- | --- |
| Mở cổng | **Chỉ** mở 8080 ra Internet hoặc load balancer. Cổng 8090 chỉ mở trong mạng private (cho trip-service) |
| Health check | Load balancer gọi `GET /actuator/health/readiness`, không phụ thuộc Redis. `/actuator/health` có tính cả Redis nên sẽ `DOWN` khi Redis lỗi. Health có ở cả 2 cổng và không cần xác thực |
| Nhiều instance gateway | Được. Sự kiện chuyến đi qua Redis Stream nên app nối vào instance nào cũng nhận được. Load balancer phải hỗ trợ WebSocket (Upgrade, timeout đủ dài cho kết nối giữ lâu) |
| Redis | Production bật **AOF** (`appendonly yes`) để "đã lưu" khi trả 202 thật sự bền vững |
| Secret | Đổi `TRIP_SERVICE_TOKEN`; đặt `RIDER/DRIVER_JWT_ISSUER` và `*_JWKS_URI` theo môi trường; cập nhật `cors.allowed-origins` cho domain web thật |
| Log | Mỗi dòng log có `[requestId]`, dùng để đối soát với log của service (cùng `X-Request-Id`) |
| Tắt máy | Graceful: chờ tối đa 20 giây cho request đang chạy |

Chạy local:

```bash
cd api-gateway && ./mvnw spring-boot:run
```

## 12. Kiểm thử

```bash
cd api-gateway && ./mvnw test
```

- Các test không cần service hay Redis đang chạy, vì service được giả bằng `StubService` và token bằng `TestTokens`.
- `RealtimeRedisIntegrationTest` cần Redis ở `localhost:6379`; không có Redis thì test tự bỏ qua.

| Test | Kiểm tra |
| --- | --- |
| `GatewayRoutingIntegrationTest` | Định tuyến mọi prefix và bỏ `/api/v1`; nhiều request đồng thời; giữ query/header và xoá `X-Service-Token`; round-robin; failover gửi lại đúng body; 503 khi quá tải; 401/403 theo role; token giả hoặc của issuer khác; route ẩn danh bỏ qua token hết hạn; không lộ `/internal`; `X-Request-Id`; CORS; 413; tách cổng nội bộ; service token; nhận/từ chối sự kiện chuyến |
| `GatewayTimeoutIntegrationTest` | Service chậm thì 504; service chết giữa lúc trả lời thì vẫn trả lỗi gateway |
| `IssuerRoutingJwtDecoderTest` | `at+jwt`, ES256, role ngoài phạm vi issuer, issuer lạ, khoá sai, lệch đồng hồ 30 giây, `exp`/`sub`, từ chối HS256/`none`, `aud`, đổi role thành authority |
| `RealtimeRedisIntegrationTest` | Đẩy sự kiện đúng người, đúng một lần, đúng thứ tự; trùng/cũ/xung đột; đóng kết nối chưa xác thực; gia hạn phải cùng danh tính; hết hạn thì đóng; chỉ tài xế gửi vị trí |
| `GatewayExceptionResolverTest`, `UpstreamFilterTest`, `ServiceInstanceSelectorTest`, `RouteConflictCheckerTest`, `SlidingWindowRateLimiterTest`, `AuthRateLimitFilterTest`, `TripEventParserTest` | Unit test từng thành phần |

## 13. Lưu ý và rủi ro (phát hiện khi đọc code)

1. **Rate limit đứng sau load balancer.**
   - `AuthRateLimitFilter` lấy IP bằng `request.getRemoteAddr()`, còn `application.yaml` chưa đặt `server.forward-headers-strategy`. Khi gateway đứng sau load balancer hoặc reverse proxy, mọi client sẽ có chung IP của load balancer, tức **cả hệ thống chỉ có 5 lần đăng nhập/phút**.
   - Cần bật `server.forward-headers-strategy: native` (hoặc `framework`), và chỉ tin `X-Forwarded-For` từ proxy của mình.
2. **Rate limit lưu trong bộ nhớ của từng instance.** Với N instance chia tải round-robin, giới hạn thực tế của một IP là khoảng N × 5/phút. Nếu cần chính xác thì chuyển bộ đếm sang Redis.
3. **Rate limit đếm mọi request**, kể cả đăng nhập thành công. Người dùng gõ sai rồi đúng vẫn bị tính lượt.
4. **Phân quyền thô.** Mọi method dưới `/api/v1/users/**`, `/drivers/**`, `/trips/**` đều được chuyển xuống nếu đúng role. Service phải tự trả 405/404 và tự kiểm quyền trên dữ liệu.
5. **Hai định dạng lỗi.** Gateway dùng `{error, meta}`. user-service (v1, và v2 theo quyết định hiện tại) dùng `{code, message, fieldErrors}`.
6. **Sự kiện phát lúc instance khởi động lại hoặc app mất mạng sẽ không được gửi lại.** App phải đồng bộ bằng `GET /api/v1/trips/active`; thiết kế hiện tại chấp nhận điều này.
7. **`/actuator/health` phụ thuộc Redis.** Nếu cấu hình nhầm load balancer gọi endpoint này, Redis lỗi sẽ kéo cả gateway ra khỏi load balancer, dù REST vẫn chạy được.

## 14. Cần nhóm chốt

1. Issuer/JWKS của Driver Service, hoặc dùng chung một Auth issuer. Nếu dùng chung thì gộp thành một mục `roles: RIDER, DRIVER`.
2. Có kiểm `aud` ở gateway không, và giá trị audience của từng service.
3. Giao thức WebSocket ở mục 6: tên tin nhắn, mã đóng, nhịp heartbeat.
4. Contract Gateway → Realtime Location (hiện chỉ ghi log) và Notification → Gateway.
5. Routing/Matching proxy đã nối; Web quản trị ngoài phạm vi.
6. Whitelist đã khớp User v2, bỏ OTP/quên mật khẩu chưa tồn tại.
7. Cách lấy IP client sau load balancer (mục 13.1), và có chuyển rate limit sang Redis không.

## 15. Deployment backend và kiểm chứng

75 tests Gateway pass với Redis test riêng. Backend Docker/Kubernetes local smoke User thật → Gateway → Trip/Routing/Price/Matching, Socket.IO GPS/offer qua Nginx và trip.event qua Gateway /ws/Redis. CORS/replay/scopes và JWT trước restart đã kiểm. [Báo cáo](../../../docs/bao-cao-tich-hop-backend.md).

Public ingress là Nginx, Java Gateway vẫn xử lý REST và /ws. Realtime Socket.IO Engine.IO path /socket.io vào namespace /realtime; không chuyển GPS qua legacy LoggingLocationForwarder của Gateway. Internal receiver 8090, matrix/probes/Price và backend ports không publish ra host. Local rate-limit override 30; trusted proxy IP, TLS/HA và production chưa nghiệm thu.
