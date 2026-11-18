# API Realtime Service

| Thuộc tính | Giá trị |
| --- | --- |
| Service | realtime-service |
| Rà soát | 2026-11-16 |
| Quy ước | [Format và số liệu](../../../docs/quy-uoc-tai-lieu.md) |

Ngày đối chiếu: 06/10/2026. GPS/offer đã liên thông dependency thật trong smoke Matching Hà Nội; từ 2026-11-05 Realtime trả vị trí thô cho Matching và không gọi Driver ([ADR-0001](../../../docs/adr/0001-matching-so-huu-tim-ung-vien.md)). [Nghiệp vụ](nghiep-vu.md), [Kiến trúc](kien-truc.md), [Routes](routes.md), [Deploy](deploy.md).

## 1. Quy ước và identity

Local default http://localhost:3004, không global prefix. Business response JSON UTF-8, camelCase, timestamp UTC. Success {data, meta:{requestId}}; error {error:{code,message,details:[]},meta:{requestId}}. Code hiện dùng message bằng chính code và details rỗng; client dựa vào code, không kỳ vọng câu dịch người dùng từ backend.

HTTP nhận X-Request-Id UUID tùy chọn. Nếu thiếu hoặc sai định dạng, Realtime sinh UUID mới; khác Trip đang mô tả từ chối header sai. Response HTTP trả X-Request-Id và Cache-Control: no-store. Socket event sinh requestId riêng trong ACK, không nhận requestId client trong payload.

Mọi tọa độ/tên/ID/thời gian/distance trong ví dụ là dữ liệu tổng hợp để mô tả hình dạng response, không phải log hay kết quả kiểm thử. Timestamp cố định trong ví dụ phải thay bằng thời gian đo mới khi gửi thật. Không có secret/JWT thật trong tài liệu.

## 2. Models và ngưỡng đã triển khai

| Model / trường | Kiểu / quy tắc |
| --- | --- |
| GPS latitude | JSON number hữu hạn, -85.05112878 đến 85.05112878; giới hạn Redis GEO, khác latitude ±90 của Trip |
| GPS longitude | JSON number hữu hạn, -180 đến 180 |
| GPS accuracy | JSON number hữu hạn, >=0 và <= LOCATION_MAX_ACCURACY_METERS; default 100 m, bắt buộc, không null |
| GPS recordedAt | UTC ISO: YYYY-MM-DDTHH:mm:ssZ hoặc YYYY-MM-DDTHH:mm:ss.sssZ; ngày giờ hợp lệ; không offset +07:00 |
| LocationReceipt | accepted:true, disposition:STORED/DUPLICATE, recordedAt, receivedAt |
| DriverLocationItem | driverId UUID, latitude, longitude, distanceMeters number, recordedAt |
| DriverLocationsResult | radiusMeters integer, drivers:DriverLocationItem[] tối đa `limit` (≤200), gần nhất trước |

Freshness default/tối đa 30.000 ms; recorded time và receive time phải trẻ hơn ngưỡng. Tuổi đạt ngưỡng bị loại. Future default 5.000 ms, min update interval default 1.000 ms, watermark retention default 24 giờ. Xem toàn config trong [Deploy](deploy.md). Backend không áp chu kỳ bắt buộc 10 giây; app và CLI loop thực hiện mục tiêu này.

## 3. S01 — Socket.IO /realtime, driver.location.update

### Kết nối và xác thực

Socket.IO v4 namespace /realtime trên cùng port HTTP; transport chỉ websocket. Engine.IO path mặc định /socket.io/ chưa có cấu hình đổi. Đây là Socket.IO protocol, không phải endpoint WebSocket thuần.

Client gửi access token qua handshake auth.token, không gửi trong URL/query hoặc actor field. SocketLocationClient và CLI đang dùng dạng sau:

```text
io(BASE_URL + '/realtime', {
  transports: ['websocket'],
  auth: { token: driverAccessToken }
})
```

JwksTokenVerifier lấy key từ AUTH_JWKS_URL; chỉ RS256. Kiểm chữ ký, issuer AUTH_JWT_ISSUER, audience AUTH_JWT_AUDIENCE (default realtime-service), exp/iat integer, sub UUID, role DRIVER. iat không được vượt đồng hồ process quá 5 giây. Verifier từ chối token rỗng, whitespace hoặc dài >8.192 ký tự; Socket.IO maxHttpBufferSize=4.096 byte còn giới hạn packet ở tầng transport.

Sau auth, server gắn driverId lowercase từ sub. Event kiểm expiry; idle socket bị server đóng khi token hết hạn. Không kiểm blacklist/revocation online. Client phải đóng socket khi logout và reconnect với JWT hợp lệ. Origin nếu có phải nằm trong SOCKET_CORS_ORIGINS; client không có Origin vẫn cần JWT đúng.

### Payload

```json
{
  "latitude": 0.0003,
  "longitude": 0.0004,
  "accuracy": 12,
  "recordedAt": "2026-10-06T00:00:00.000Z"
}
```

Không nhận driverId, status, vehicleType hay trường thừa; numeric string như "12" không được chuyển ngầm. Payload phải là object, không array/null. Accuracy vượt ngưỡng cấu hình được Domain từ chối INVALID_REQUEST. Time stale/future được kiểm ở process rồi kiểm lại bằng Redis TIME trong Lua.

### ACK thành công

```json
{
  "data": {
    "accepted": true,
    "disposition": "STORED",
    "recordedAt": "2026-10-06T00:00:00.000Z",
    "receivedAt": "2026-10-06T00:00:00.020Z"
  },
  "meta": { "requestId": "90000000-0000-4000-8000-000000000001" }
}
```

DUPLICATE dùng cùng shape với disposition khác; returned receivedAt là thời gian nhận mẫu cũ, không time retry. Chỉ duplicate cùng recorded time/tọa độ/accuracy khi mẫu còn hợp lệ; không gia hạn expiry. Time nhỏ hơn watermark, hoặc bằng nhưng payload khác/metadata không còn: LOCATION_OUT_OF_ORDER. Redis ACK không khẳng định durability trên đĩa, AVAILABLE hay assignment.

### ACK thất bại và handshake lỗi

```json
{
  "error": { "code": "LOCATION_OUT_OF_ORDER", "message": "LOCATION_OUT_OF_ORDER", "details": [] },
  "meta": { "requestId": "90000000-0000-4000-8000-000000000002" }
}
```

ACK lỗi không có data.accepted=false: phân biệt bằng error. Nó không có HTTP status. Lỗi trước khi kết nối namespace là connect_error; client nhận Error.message và Error.data.code, ví dụ UNAUTHENTICATED hoặc DEPENDENCY_UNAVAILABLE, không phải ACK envelope. JWT sai thường map UNAUTHENTICATED; ERR_JWKS_TIMEOUT/TypeError map dependency, không cam kết mọi loại JWKS lỗi đều có cùng phân loại.

| Code có thể gặp ở socket | Nghĩa |
| --- | --- |
| INVALID_REQUEST | DTO/tọa độ/accuracy/ngày giờ sai hoặc unknown field |
| UNAUTHENTICATED | Identity/JWT/claims/expiry sai |
| LOCATION_STALE | now - recordedAt >= freshness |
| LOCATION_IN_FUTURE | recordedAt > now + maxFuture |
| LOCATION_OUT_OF_ORDER | Mẫu cũ hoặc cùng time khác nội dung |
| RATE_LIMITED | Mẫu mới đến trước min interval server |
| DEPENDENCY_UNAVAILABLE | Redis hoặc loại JWKS lỗi được adapter map |
| INTERNAL_ERROR | Lỗi không dự kiến, không trả stack |

ACK timeout 5 giây trong app/CLI là lỗi client ACK_TIMEOUT, không phải error.code backend. Nó không chứng minh lệnh chưa ghi Redis. App đo mẫu mới ở chu kỳ sau; CLI có thể gửi cùng mẫu để quan sát duplicate nếu vẫn còn freshness.

## 4. R02 — GET /internal/realtime/driver-locations

Cho Matching tìm ứng viên ([ADR-0001](../../../docs/adr/0001-matching-so-huu-tim-ung-vien.md)). X-Service-Token = `MATCHING_LOCATION_TOKEN`; thiếu cấu hình thì mọi caller nhận 401 `INVALID_SERVICE_CREDENTIAL`.

Query: `latitude`, `longitude` bắt buộc; `radiusMeters` 1–2000 (mặc định 2000); `limit` 1–200 (mặc định 50); `offset` 0–4800 (mặc định 0), vị trí bắt đầu trong thứ hạng theo khoảng cách. Data `{radiusMeters, drivers:[{driverId, latitude, longitude, distanceMeters, recordedAt}], nextOffset}`, gần nhất trước, chỉ vị trí còn mới. `nextOffset` là `offset` của trang sau, `null` khi bán kính không còn tài xế hoặc trang sau sẽ bắt đầu quá 4800. Thứ hạng tính cả vị trí đã cũ, nên một trang có thể ít hơn `limit` người mà vẫn còn trang sau. Không lọc loại xe hay trạng thái tài xế; Matching đọc trang sau khi cả trang đều bận. Redis dùng `GEOSEARCH ... COUNT offset+limit+1` nên chi phí mỗi lần tìm có trần (tối đa 5001 dòng). Lỗi: 400 INVALID_REQUEST, 401 INVALID_SERVICE_CREDENTIAL, 503 DEPENDENCY_UNAVAILABLE khi Redis lỗi (có Retry-After: 1). Thay cho R01 `/nearby-drivers` đã gỡ ngày 2026-11-05.

## 5. H01/H02 — health đã có

| Endpoint | Status / body | Phạm vi chứng minh |
| --- | --- | --- |
| GET /health/live | 200 {"status":"ok"} | Process đáp ứng probe |
| GET /health/ready | 200 {"status":"ready","redis":"ready"} | Redis PING trả PONG |
| GET /health/ready khi Redis lỗi | 503 {"status":"not_ready","redis":"unavailable"} | Redis chưa sẵn sàng |

Không dùng business envelope hoặc meta trong body; middleware HTTP vẫn đặt X-Request-Id/no-store. Hai endpoint không auth guard trong code; hạn chế exposure bằng mạng vận hành khi deploy. Ready không kiểm Driver/JWKS/Trip, schema DB hoặc quyền Redis EVAL/GEO. Realtime không có /docs hay /openapi.json.

## 7. O02 — JWKS Driver

GET AUTH_JWKS_URL, sample /.well-known/jwks.json tại Driver, không service token. Response {keys:[public JWK]} không business envelope. Driver dùng RsaTokens; JWT audience mặc định hiện có realtime-service nhưng private .env có thể override. Khi đổi config/key cần JWT phù hợp và kiểm issuer chính xác; không dùng JWT của Trip mock issuer thay thế.

Realtime không làm issuer/JWKS server hoặc refresh endpoint riêng. JWKS cache/cooldown thuộc jose; code cấu hình cooldown 5.000 ms và timeout riêng. Driver local không keyFile sinh key/kid mới mỗi process; restart có thể làm token cũ không còn được key hiện tại xác minh.

## 8. Contract liên service và giới hạn

| Điểm | Đã có | Chưa được xác nhận / triển khai |
| --- | --- | --- |
| Matching driver-locations | Matching gọi mỗi lần tìm xe, credential riêng | Ingress production chưa nghiệm thu |
| Mã xe | Luồng mới BIKE/CAR_4/CAR_7 | CAR/MOCK_BIKE là legacy/mock riêng, không nhận trong Realtime |
| Redis ownership | Realtime realtime:{gps}:* | Chuyển consumer từ drivers:geo:* theo thiết kế Driver cũ; không có dual-write |
| Gateway chuẩn | Base URL trực tiếp hoạt động theo thiết kế code | TLS/proxy namespace/path/origin/exposure; chưa có ingress trong service |
| US8 | Thu nhận GPS là nền tảng | API/room theo tripId, rider authorization và Trip event receiver chưa có |

Trip có POST /internal/trips/active-drivers/batch cho Driver bằng credential riêng; GET /trips/active vẫn dùng JWT người dùng. Snapshot eligible có thể stale sau lần đọc; Matching/Trip kiểm lại lúc phân công.

## 9. Giao offer qua RabbitMQ và Socket.IO

Khi cấu hình RABBITMQ_URL, MATCHING_BASE_URL và MATCHING_REALTIME_TOKEN, OfferConsumer nhận DRIVER_TRIP_OFFER / DRIVER_TRIP_OFFER_UPDATED từ durable queue driver.offers. Consumer lấy state authoritative từ Matching, giữ version/tombstone Redis rồi emit `driver.trip.offer` hoặc `driver.trip.offer.updated` với `{data:<offer>}` vào room `driver:<sub>` từ JWT; không nhận room do app tự khai.

Reconnect lấy offer của chính driver; không reset expiresAt 20 giây. Duplicate/đảo thứ tự/terminal được lọc; retry queues, confirms/manual ACK và DLQ giữ event ID. App accept/decline qua REST Matching. Xem [API Matching](../../matching-service/docs/api.md) và [báo cáo kiểm chứng](../../matching-service/docs/bao-cao-trien-khai.md).
