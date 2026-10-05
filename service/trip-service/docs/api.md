# API Trip Service

| Thuộc tính | Giá trị |
| --- | --- |
| Service | trip-service |
| Rà soát | 2026-10-06 |
| Quy ước | [Format và số liệu](../../../docs/quy-uoc-tai-lieu.md) |

Ngày cập nhật: 05/10/2026. Contract Trip: 1.0. R01–R08 đã triển khai, OpenAPI sinh từ controller và DTO tại `/openapi.json` khi bật Swagger. Contract service ngoài được kiểm chứng bằng mock, cần bên sở hữu xác nhận trước tích hợp thật.

Nghiệp vụ chuẩn: [Nghiệp vụ](nghiep-vu.md). Danh mục đường dẫn/exposure: [Routes](routes.md). Transaction và adapter: [Kiến trúc](kien-truc.md). Base URL, credential và port: [Deploy](deploy.md).

Quy tắc nghiệp vụ đã chốt giữ nguyên. Tên trường, envelope, lỗi và JWT claims dưới đây là mặc định kỹ thuật đã triển khai để review. `MOCK_BIKE` chỉ dùng local/test; danh mục xe thật và prefix Gateway vẫn cần thống nhất với các service liên quan.

## 1. Quy ước HTTP và identity

- Local Trip base URL đề xuất: `http://localhost:3001`. Route public Gateway đề xuất thêm `/api/v1`; xem Routes.
- Request/response nghiệp vụ dùng JSON UTF-8. Trường ngoài DTO bị từ chối, không âm thầm bỏ qua.
- UUID là chuỗi; thời gian ISO 8601 UTC; khoảng cách mét và duration giây là số nguyên không âm.
- Tiền VND là chuỗi số nguyên thập phân không âm, ví dụ `"45000"`, không dùng JSON number. Không chấp nhận dấu phân cách hàng nghìn hoặc phần thập phân.
- Header `Authorization: Bearer <jwt>` bắt buộc cho R01–R07. Token có chữ ký được xác minh, `sub` UUID, `role` là `RIDER` hoặc `DRIVER`, issuer/audience/expiry đúng cấu hình.
- Body không nhận `riderId`, actor ID hoặc driver ID để tự nhận quyền. Identity do auth verifier cung cấp.
- `X-Request-Id` là UUID tùy chọn; server sinh mới nếu không có, từ chối giá trị sai định dạng. Response trả lại trong header và `meta.requestId`.
- R02/R06/R07 yêu cầu `Idempotency-Key` là UUID. R08 dùng `eventId` UUID trong body và credential Matching riêng.
- API người dùng trả `Cache-Control: no-store`. Gateway giữ nguyên request key, token và correlation header khi proxy.

Envelope thành công nghiệp vụ: `{ "data": <result>, "meta": { "requestId": "<uuid>" } }`. Envelope lỗi: `{ "error": { "code": "<code>", "message": "<message>", "details": [] }, "meta": { "requestId": "<uuid>" } }`. Client dựa vào `code`, không parse `message`; `details` không có credential hoặc dữ liệu của người khác.

Swagger UI/OpenAPI được tạo bằng [NestJS OpenAPI](https://docs.nestjs.com/openapi/introduction). DTO dùng Zod strict và cùng schema chuyển sang OpenAPI bằng [Zod JSON Schema](https://zod.dev/json-schema); từ chối unknown field, kiểm tra kiểu tường minh và chỉ chuyển `limit` sau khi xác minh chuỗi số nguyên. JWT dùng [jose remote JWKS](https://github.com/panva/jose/blob/main/docs/jwks/remote/functions/createRemoteJWKSet.md), chỉ RS256/ES256, yêu cầu `exp`, `sub`, `role` và xác minh issuer/audience.

## 2. Các model dùng chung

| Model | Trường và ràng buộc đề xuất |
| --- | --- |
| `Location` | `lat`: number [-90, 90]; `lng`: number [-180, 180]; `address`: string 1–500 ký tự nếu có. lat/lng bắt buộc, không tin address để thay tọa độ |
| `VehicleType` | Trip nhận string 1–32 được SUPPORTED_VEHICLE_TYPES cho phép; luồng mới BIKE/CAR_4/CAR_7. CAR/MOCK_BIKE chỉ ở cấu hình legacy/mock; placeholder trong ví dụ phải thay |
| `RouteSummary` | `distanceMeters`, `durationSeconds`: integer không âm. V1 contract này chỉ có summary; geometry hiển thị bản đồ là phần mở rộng cần duyệt contract Routing |
| `FareBreakdownLine` | `code`: string do Pricing định nghĩa; `amount`: chuỗi tiền không âm. Các dòng phải cộng đúng tổng giá v1; Trip kiểm tra tính hợp lệ, không tính công thức giá |
| `QuoteFare` | `currency: "VND"`, `amount`, `breakdown: FareBreakdownLine[]` |
| `TripFare` | `currency: "VND"`, `estimatedAmount`, `finalAmount`: chuỗi tiền hoặc null, `breakdown` snapshot. final chỉ có khi COMPLETED và bằng estimated |
| `DriverSnapshot` | `fullName`: string 1–100; `avatarUrl`: HTTPS URL hoặc null. Response thêm `driverId` từ assignment, không có credential/hồ sơ nhạy cảm |
| `VehicleSnapshot` | `vehicleType`, `licensePlate`: string 1–32; `brand`, `color`: string 1–100 hoặc null. Response thêm `vehicleId`; loại xe phải khớp quote |
| `Cancellation` | `actorType`: RIDER/DRIVER, `actorId`: UUID, `reason`: string, `cancelledAt`: timestamp; null nếu chưa hủy |
| `HistoryEntry` | `fromStatus`: status hoặc null khi khởi tạo; `toStatus`, `actorType`: RIDER/DRIVER/SYSTEM, `actorId`: UUID hoặc null với SYSTEM, `occurredAt`, `version` |

`TripDTO` gồm `tripId`, `quoteId`, `riderId`, `driverId`/`vehicleId` nullable, `status`, `version`, `pickup`, `destination`, `vehicleType`, `route`, `fare`, `driver`/`vehicle` nullable, `timestamps` và `cancellation`. `version` trả về tối thiểu 1 vì Create trả `SEARCHING`; history khởi tạo có version 0.

`timestamps` gồm `requestedAt` bắt buộc và `assignedAt`, `driverArrivedAt`, `startedAt`, `completedAt`, `cancelledAt` nullable. Timestamp trạng thái do Trip ghi bằng thời gian server, không nhận timestamp client để thay thế.

Trạng thái: `CREATED`, `SEARCHING`, `ASSIGNED`, `DRIVER_ARRIVED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`. Chỉ ba trạng thái tài xế được cập nhật qua R06; hủy dùng R07, gán dùng R08.

## 3. R01 — POST /trips/estimate

**Quyền:** RIDER. Không cần idempotency key; gửi lại có thể phát hành quote mới, chưa tạo chuyến.

```json
{
  "pickup": { "lat": 10.7769, "lng": 106.7009, "address": "Điểm đón minh họa" },
  "destination": { "lat": 10.782, "lng": 106.69, "address": "Điểm trả minh họa" },
  "vehicleType": "VEHICLE_TYPE_CODE"
}
```

**200:** quote giữ giá 5 phút từ `createdAt`. Không có rider ID trong response quote vì đã gắn identity ở server.

```json
{
  "data": {
    "quoteId": "10000000-0000-4000-8000-000000000001",
    "pickup": { "lat": 10.7769, "lng": 106.7009, "address": "Điểm đón minh họa" },
    "destination": { "lat": 10.782, "lng": 106.69, "address": "Điểm trả minh họa" },
    "vehicleType": "VEHICLE_TYPE_CODE",
    "route": { "distanceMeters": 4000, "durationSeconds": 600 },
    "fare": {
      "currency": "VND",
      "amount": "45000",
      "breakdown": [
        { "code": "BASE", "amount": "12000" },
        { "code": "DISTANCE", "amount": "28000" },
        { "code": "TIME", "amount": "5000" }
      ]
    },
    "createdAt": "2026-10-05T02:00:00Z",
    "expiresAt": "2026-10-05T02:05:00Z"
  },
  "meta": { "requestId": "90000000-0000-4000-8000-000000000001" }
}
```

Mã breakdown là minh họa, không phải công thức Trip. Lỗi: 400 input/mã xe chưa hỗ trợ; 401/403 auth/role; 503 Routing/Pricing lỗi hoặc trả dữ liệu không hợp lệ. Không phát hành quote hợp lệ từ kết quả dependency lỗi.

## 4. R02 — POST /trips

**Quyền:** RIDER. Header bắt buộc `Idempotency-Key: 80000000-0000-4000-8000-000000000001`.

```json
{
  "quoteId": "10000000-0000-4000-8000-000000000001"
}
```

**201:** `data` là TripDTO ở SEARCHING; header `Location: /trips/<tripId>`. Không trả ASSIGNED trong lần tạo ban đầu dù Matching có thể xử lý rất nhanh sau commit.

```json
{
  "data": {
    "tripId": "20000000-0000-4000-8000-000000000001",
    "quoteId": "10000000-0000-4000-8000-000000000001",
    "riderId": "30000000-0000-4000-8000-000000000001",
    "driverId": null,
    "vehicleId": null,
    "status": "SEARCHING",
    "version": 1,
    "pickup": { "lat": 10.7769, "lng": 106.7009, "address": "Điểm đón minh họa" },
    "destination": { "lat": 10.782, "lng": 106.69, "address": "Điểm trả minh họa" },
    "vehicleType": "VEHICLE_TYPE_CODE",
    "route": { "distanceMeters": 4000, "durationSeconds": 600 },
    "fare": {
      "currency": "VND",
      "estimatedAmount": "45000",
      "finalAmount": null,
      "breakdown": [
        { "code": "BASE", "amount": "12000" },
        { "code": "DISTANCE", "amount": "28000" },
        { "code": "TIME", "amount": "5000" }
      ]
    },
    "driver": null,
    "vehicle": null,
    "timestamps": {
      "requestedAt": "2026-10-05T02:01:00Z",
      "assignedAt": null,
      "driverArrivedAt": null,
      "startedAt": null,
      "completedAt": null,
      "cancelledAt": null
    },
    "cancellation": null
  },
  "meta": { "requestId": "90000000-0000-4000-8000-000000000002" }
}
```

Quote của khách khác trả 404 như quote không tồn tại. Quote hết hạn/đã dùng bởi yêu cầu khác hoặc khách có chuyến active trả 409. Matching chưa sẵn sàng sau commit không đổi 201 thành lỗi tạo; lệnh trong outbox chờ gửi lại.

## 5. R03/R04/R05 — đọc chuyến

### GET /trips/active

RIDER tra theo rider ID; DRIVER tra theo driver ID được gán. **200** `data` là TripDTO hoặc null nếu không có chuyến active. Tài xế chưa được gán không nhận một chuyến chỉ vì đã được mời. Không có tham số chọn actor khác.

### GET /trips/history

Query: `limit` integer mặc định 20, từ 1–100; `cursor` string opaque tối đa 2048 ký tự; `status` tùy chọn chỉ COMPLETED/CANCELLED. Mặc định lấy cả hai trạng thái kết thúc của người gọi.

Sắp xếp `requestedAt DESC, tripId DESC`. Cursor ký xác thực chứa khóa trang cuối và scope principal/filter; dùng lại với filter khác hoặc cursor sai trả 400. Phân trang keyset, không cam kết snapshot toàn bộ lịch sử khi có chuyến mới kết thúc giữa hai request.

**200** `data` là `{ "items": [<TripDTO>], "nextCursor": <string|null> }`. Ví dụ trang rỗng:

```json
{
  "data": { "items": [], "nextCursor": null },
  "meta": { "requestId": "90000000-0000-4000-8000-000000000003" }
}
```

### GET /trips/:id

UUID hợp lệ; chỉ RIDER sở hữu hoặc DRIVER được gán. **200** `data` là `{ "trip": <TripDTO>, "statusHistory": [<HistoryEntry>] }`. History theo version tăng dần, gồm khởi tạo và các chuyển trạng thái; actor ID chỉ trả cho người được phép xem chuyến, không có log vận hành/outbox trong response.

Lỗi: 400 UUID/query sai; 401 auth; 404 không có chuyến hoặc không được xem. Không tiết lộ owner/status/version qua lỗi 404.

## 6. R06 — PATCH /trips/:id/status

**Quyền:** DRIVER được gán. Bắt buộc idempotency key mới cho từng hành động mới.

```json
{
  "status": "DRIVER_ARRIVED",
  "version": 2
}
```

| Body status | Trạng thái hiện tại cần có | Kết quả |
| --- | --- | --- |
| DRIVER_ARRIVED | ASSIGNED | Ghi driverArrivedAt, version + 1 |
| IN_PROGRESS | DRIVER_ARRIVED | Ghi startedAt, version + 1 |
| COMPLETED | IN_PROGRESS | Ghi completedAt, finalAmount = estimatedAmount, version + 1 |

`version` integer >= 1 là version client đang thấy. Không nhận giá cuối, khoảng cách thực tế hoặc timestamp từ client trong body v1.

**200** `data` là TripDTO sau cập nhật. Lỗi: 400 DTO/status không thuộc ba giá trị được nhận; 403 khách cố dùng API driver trên chuyến của mình; 404 người ngoài; 409 version cũ hoặc transition sai. Read mới và gửi key mới nếu người dùng quyết định thực hiện một hành động mới sau conflict.

## 7. R07 — POST /trips/:id/cancel

**Quyền:** RIDER sở hữu hoặc DRIVER được gán, trước IN_PROGRESS. Bắt buộc idempotency key.

```json
{
  "reason": "Kế hoạch thay đổi",
  "version": 1
}
```

`reason` bắt buộc, trim khoảng trắng, 1–500 ký tự; `version` integer >= 1. Actor do server xác định, không nhận `cancelledBy` từ body.

**200** `data` là TripDTO CANCELLED: timestamp/cancellation đã lưu, finalAmount null. Không tính phí hủy, không tự tạo chuyến khác hoặc quay về SEARCHING. Delivery dừng tìm/giải phóng có thể tiếp tục retry sau khi API trả 200.

Lỗi: 400 DTO; 404 người ngoài/không có chuyến; 409 version cũ hoặc trạng thái không cho phép hủy. Chỉ retry đúng request đã thành công mới replay kết quả; yêu cầu mới vào chuyến đã kết thúc không tạo lần hủy mới.

## 8. R08 — POST /internal/trips/:id/assignment

**Bên gọi:** Matching, mạng private, header `X-Service-Token: <matching-callback-token>`. Không chấp nhận JWT người dùng thay service credential. Request ID tùy chọn, không yêu cầu Idempotency-Key.

```json
{
  "eventId": "60000000-0000-4000-8000-000000000001",
  "driverId": "40000000-0000-4000-8000-000000000001",
  "vehicleId": "50000000-0000-4000-8000-000000000001",
  "driverSnapshot": { "fullName": "Tài xế minh họa", "avatarUrl": null },
  "vehicleSnapshot": {
    "vehicleType": "VEHICLE_TYPE_CODE",
    "licensePlate": "BIEN-SO-MAU",
    "brand": null,
    "color": null
  }
}
```

Matching chỉ gửi sau khi tài xế chấp nhận; snapshot phải lấy từ nguồn Driver hợp lệ, loại xe khớp quote. Trip ghi assignedAt bằng thời gian server. Callback không nhận trạng thái/giá tùy ý hoặc quyền ép gán tài xế bận.

**202** là assignment đã commit, không chỉ đã nhận HTTP:

```json
{
  "data": {
    "eventId": "60000000-0000-4000-8000-000000000001",
    "tripId": "20000000-0000-4000-8000-000000000001",
    "accepted": true,
    "assignedVersion": 2
  },
  "meta": { "requestId": "90000000-0000-4000-8000-000000000004" }
}
```

Event ID trùng và nội dung giống nhận cùng ACK, không ghi lại assignment. ACK phản ánh lần assignment đó, không cam kết chuyến hiện tại vẫn ASSIGNED: có thể đã hủy/hoàn thành sau đó. Matching không được mở lại reservation từ ACK replay.

Lỗi: 400 body; 401 credential; 404 Trip không có; 409 event ID dùng lại khác nội dung, tài xế bận, chuyến không còn SEARCHING hoặc đã gán người khác. Với assignment bị từ chối, Matching giải phóng ứng viên; nếu Trip còn SEARCHING thì tiếp tục tìm. Lỗi tạm thời 503/network phải retry **cùng event ID**, không đổi ID để né chống lặp.

## 9. Idempotency và version

- Scope key người dùng là `(actorType, actorId, Idempotency-Key)` trên toàn bộ R02/R06/R07. Hash gồm method, route/target và body đã validate/normalize, bao gồm version. Không tái dùng key giữa các hành động.
- Xác thực/role được kiểm tra trước receipt. Receipt chỉ đọc trong scope đúng actor; không dùng key để truy cập kết quả của người khác.
- Receipt thành công lưu cùng transaction của tác dụng nghiệp vụ. Request lặp cùng nội dung replay cùng status code/data, thêm `Idempotent-Replay: true`; meta/request ID của lần gọi mới được cập nhật.
- Replay trả snapshot kết quả ban đầu, có thể cũ hơn trạng thái hiện tại. Client GET Trip để refresh; không áp dụng snapshot cũ lên UI đã thấy version mới hơn.
- Hai request cùng key đang xử lý được serialize bởi unique receipt và transaction; chờ có giới hạn, hết chờ trả 503 có thể retry cùng key. Không tạo hai tác dụng.
- Thất bại trước commit không tiêu thụ key; retry sau lỗi mạng/503 dùng cùng key/body. Với conflict cần sửa body/version, dùng key mới.
- Callback scope là `(source=matching, eventId)` với hash gồm trip ID và body. Receipt/inbox không tự purge trong v1 trước khi có chính sách retention được duyệt.
- Version lookup để retry thành công diễn ra trước kiểm tra version cũ, nhưng không bỏ qua xác thực và scope actor.

## 10. Mã lỗi

| HTTP | Code đề xuất | Ý nghĩa |
| --- | --- | --- |
| 400 | INVALID_REQUEST | Sai DTO, thiếu header, UUID/query/vehicle type không hợp lệ hoặc unknown field |
| 400 | INVALID_CURSOR | Cursor sai hoặc không thuộc scope/filter |
| 401 | UNAUTHENTICATED | JWT không hợp lệ hoặc thiếu |
| 401 | INVALID_SERVICE_CREDENTIAL | Matching credential không hợp lệ |
| 403 | FORBIDDEN_ACTION | Actor được xem resource nhưng không có quyền thực hiện hành động |
| 404 | RESOURCE_NOT_FOUND | Không có hoặc không được xem Trip/quote |
| 409 | ACTIVE_TRIP_EXISTS | Khách đã có chuyến active |
| 409 | QUOTE_EXPIRED / QUOTE_ALREADY_USED | Quote không còn dùng cho lần tạo mới |
| 409 | DRIVER_HAS_ACTIVE_TRIP | Tài xế đã có assignment active |
| 409 | TRIP_ALREADY_ASSIGNED / TRIP_NOT_SEARCHING | Assignment không phù hợp trạng thái |
| 409 | INVALID_TRANSITION / VERSION_CONFLICT | Hành động sai vòng đời hoặc dữ liệu cũ |
| 409 | IDEMPOTENCY_KEY_REUSED / EVENT_ID_REUSED | Cùng key/ID nhưng nội dung khác |
| 503 | DEPENDENCY_UNAVAILABLE | Routing/Pricing lỗi hoặc trả response sai, DB tạm lỗi, transaction retry hết giới hạn |
| 503 | REQUEST_IN_PROGRESS | Request cùng key chưa có kết quả trong thời gian chờ |
| 500 | INTERNAL_ERROR | Lỗi không dự kiến; không trả stack trace |

Ví dụ lỗi version; details không chứa dữ liệu nhạy cảm:

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "Chuyến đã thay đổi; tải lại thông tin trước khi thao tác.",
    "details": []
  },
  "meta": { "requestId": "90000000-0000-4000-8000-000000000005" }
}
```

## 11. Contract Trip gọi ra ngoài

Tất cả O01–O07 trong Routes dùng `X-Service-Token` riêng cho đích và `X-Request-Id`. Route/body sau là contract Trip đã triển khai với mock; cần chủ service ngoài xác nhận, không mô tả implementation thật của họ.

| Route | Request | Response thành công |
| --- | --- | --- |
| O01 Routing estimate | `{pickup: Location, destination: Location, vehicleType: VehicleType}` | 200 `data: RouteSummary` |
| O02 Pricing estimate | `{route: RouteSummary, vehicleType: VehicleType}` | 200 `data: QuoteFare` |
| O03 Matching start | Command tìm ở ví dụ dưới | 202 `data: {commandId, accepted: true}` sau lưu bền vững |
| O04 Matching cancel | `{commandId, type: "matching.search.cancelled", tripId, tripVersion, occurredAt, reason}` | 202 `data: {commandId, accepted: true}`, kể cả cần tạo terminal marker trước khi thấy search |
| O05/O06 event | Event envelope ở mục 12 | 202 `data: {eventId, accepted: true}` sau lưu bền vững |
| O07 Matching completion | Event `trip.completed` ở mục 12, gửi `POST /internal/events/trips` đến Matching | 202 `data: {eventId, accepted: true}`; kết thúc reservation và giữ terminal marker |

O01–O07 trả envelope với `meta.requestId`; ACK phải trả đúng command/event ID đang gửi. HTTP timeout không chứng minh bên nhận chưa xử lý. Worker retry command/event cùng ID. HTTP client giới hạn response 1 MiB và yêu cầu JSON hợp lệ; không lưu quote từ dữ liệu dependency lỗi.

O07 bổ sung điểm kết thúc reservation khi chuyến hoàn thành, ngoài lệnh hủy O04. Đây là phần hoàn thiện contract vận hành, giữ nguyên chính sách giá/vòng đời. Matching thật phải xác nhận contract này; completion/cancel đến trước search vẫn không được mở lại tìm.

Command tìm mẫu:

```json
{
  "commandId": "70000000-0000-4000-8000-000000000001",
  "type": "matching.search.requested",
  "tripId": "20000000-0000-4000-8000-000000000001",
  "tripVersion": 1,
  "occurredAt": "2026-10-05T02:01:00Z",
  "riderId": "30000000-0000-4000-8000-000000000001",
  "pickup": { "lat": 10.7769, "lng": 106.7009 },
  "destination": { "lat": 10.782, "lng": 106.69 },
  "vehicleType": "VEHICLE_TYPE_CODE",
  "route": { "distanceMeters": 4000, "durationSeconds": 600 },
  "fare": { "currency": "VND", "amount": "45000" }
}
```

Command UUID giữ nguyên khi retry; type/ID/Trip version không đổi. Matching lưu chống lặp và terminal marker theo Trip để cancel đến trước search vẫn không mở lại tìm. Tiếp nhận O03 không có nghĩa tài xế đã nhận; Matching tiếp tục tìm không có deadline cấp chuyến. Khi nhận O04, phải dừng tìm và giải phóng mọi ứng viên/reservation của Trip theo trạng thái hiện tại.

## 12. Sự kiện trạng thái

| Event type | Trạng thái ứng với event |
| --- | --- |
| trip.searching | SEARCHING |
| trip.assigned | ASSIGNED |
| trip.driver_arrived | DRIVER_ARRIVED |
| trip.started | IN_PROGRESS |
| trip.completed | COMPLETED |
| trip.cancelled | CANCELLED |

Envelope chung cho Gateway, Notification và event completion gửi Matching:

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

Payload v1 tối thiểu; client đọc chi tiết qua API được phân quyền. Không gửi credential/snapshot hồ sơ đầy đủ trong event. Event ID chống lặp; event version thấp hơn version consumer đã xử lý không được đưa UI về trạng thái cũ. Gateway/Notification ACK chỉ nghĩa đã lưu event, không nghĩa thiết bị đã nhận.

## 13. Health và Swagger

- API live: 200 `{"status":"ok"}` khi process phục vụ được probe; không yêu cầu dependency ngoài.
- API ready: 200 `{"status":"ok"}` khi DB và schema tương thích; 503 `{"status":"unavailable"}` nếu không. Không fail chỉ vì Matching/Notification lỗi.
- Worker live/ready dùng cùng payload trên port 3002; readiness còn kiểm tra dispatch loop có tiến triển. Worker là process khác, không dùng API probe thay thế.
- Probe không dùng envelope nghiệp vụ, không trả chi tiết credential/schema hoặc stack trace.
- `/docs` là HTML Swagger UI, `/openapi.json` là OpenAPI JSON không bọc envelope; production mặc định tắt và không public qua Gateway.

## 14. Checklist contract

- [ ] Có đủ R01–R08 và quyền đúng như Routes/nghiệp vụ; probe và Swagger đúng exposure.
- [ ] Ví dụ tiền là chuỗi, version/timestamp/nullable nhất quán; quote expire đúng 5 phút.
- [ ] Retry create không tạo thêm; callback replay không mở lại assignment; replay snapshot cũ không làm UI lùi version.
- [ ] Quote chủ khác và Trip không được xem cùng trả 404; internal credential không dùng JWT public.
- [ ] Mã loại xe, breakdown, snapshot và auth claims đã được bên sở hữu contract xác nhận.
- [ ] O03/O04 và event receiver chống lặp, lưu bền vững trước ACK, xử lý cancel/search sai thứ tự.
- [ ] Không thêm deadline tìm xe, phí hủy hoặc tính lại giá vào DTO/handler.
- [x] OpenAPI sinh từ controller và cùng DTO, có kiểm thử các routes và schema request/response.

## 15. Internal lookups đã triển khai

| API | Caller / credential | Input | 200 data |
| --- | --- | --- | --- |
| GET /internal/trips/:id/matching-state | Matching; MATCHING_CALLBACK_TOKEN | UUID Trip | `{tripId,status,driverId,version}`; null nếu không tồn tại |
| POST /internal/trips/active-drivers/batch | Driver; DRIVER_LOOKUP_TOKEN riêng | `{driverIds:[UUID]}`; 1–100 unique, body strict | `{items:[{driverId,tripId:UUID hoặc null}]}` |

Không proxy lookup ra Gateway; không dùng JWT người dùng thay service credential. Thiếu/sai credential 401, body/path sai 400, database lỗi 503. Matching coi missing state là đối soát chưa thành công, không suy Trip SEARCHING hoặc driver rảnh từ null. Batch availability không thay constraints active Trip hoặc reservation lúc gán.
