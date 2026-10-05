# Thiết kế API Routing Service

| Thuộc tính | Giá trị |
| --- | --- |
| Service | routing-service |
| Rà soát | 2026-10-06 |
| Quy ước | [Format và số liệu](../../../docs/quy-uoc-tai-lieu.md) |

Ngày cập nhật: 06/10/2026. R01–R04 đã triển khai và kiểm thử qua NestJS HTTP; R01 được kiểm tra bằng Trip client/use case thật. R02–R04 vẫn cần consumer validate nghiệp vụ tích hợp. REST JSON cho phase 1; chưa có gRPC. Realtime HTTP adapter đã nối nearby API hiện có và nghiệm thu ETA qua OSRM Hà Nội.

## 1. Quy ước chung

- Caller dùng `X-Service-Token` riêng: Trip, Matching, Gateway; token xác định scope server-side, không nhận role từ body.
- `X-Request-Id` là UUID. Giữ nguyên ID hợp lệ từ caller; nếu thiếu thì server sinh ID. Header sai định dạng trả 400. Response có header cùng ID và envelope `meta.requestId`.
- Success: `{"data": ..., "meta": {"requestId": "UUID"}}`. Error: `{"error":{"code":"CODE","message":"CODE","details":[]},"meta":{"requestId":"UUID"}}`.
- `Content-Type: application/json`; proposal body limit 64 KiB và provider response cap theo config. Schema request từ chối field ngoài contract.
- Tất cả endpoint tính toán trả kết quả trong cùng request, 200 hoặc lỗi; không có 202/job-status API trong phase 1. RequestId không bảo đảm dedupe hoặc miễn phí khi retry.
- `Location`: `{lat:number, lng:number, address?:string}`. Dùng tọa độ để tính; address chỉ là nhãn, tối đa 500 ký tự, không geocode từ address. `vehicleType`: mã dự án 1–32 ký tự, trong allowlist cấu hình.
- `distanceMeters`/`durationSeconds`: integer [0, 2147483647]. Thời điểm response full route là ISO 8601 UTC. Provider duration được chuẩn hóa từ trường máy đọc được, làm tròn lên khi có phần thập phân.
- Giá trị địa điểm/số đo trong ví dụ là minh họa, không phải kết quả gọi provider hay công thức mock đã triển khai.

## 2. R01 — POST /internal/routes/estimate

Caller: Trip. Header token phải khớp giá trị `ROUTING_TOKEN` ở phía Trip. Thời gian toàn request Routing nhỏ hơn timeout phía Trip.

Request tương thích [RoutingClient hiện có](../../trip-service/src/infrastructure/clients/routing.ts):

```json
{
  "pickup": {"lat": 10.7769, "lng": 106.7009, "address": "Điểm đón"},
  "destination": {"lat": 10.7820, "lng": 106.6950, "address": "Điểm trả"},
  "vehicleType": "MOCK_BIKE"
}
```

Response 200:

```json
{
  "data": {"distanceMeters": 4000, "durationSeconds": 600},
  "meta": {"requestId": "90000000-0000-4000-8000-000000000001"}
}
```

**`data` chỉ có hai field này.** Trip dùng `.strict()` và sẽ từ chối nếu thêm polyline/steps/provider vào data. Không tạo quote, giá hoặc chuyến trong endpoint này. Mã `MOCK_BIKE` dùng để tương thích kiểm thử hiện tại; real vehicle codes phải được thống nhất.

## 3. R02 — POST /routes

Caller đề xuất: Gateway; Trip được mở scope full route nếu sau này cần hiển thị và đã thống nhất contract. Body:

```json
{
  "origin": {"lat": 10.7769, "lng": 106.7009},
  "destination": {"lat": 10.7820, "lng": 106.6950},
  "vehicleType": "BIKE",
  "includeSteps": false
}
```

`includeSteps` mặc định false. `BIKE` là mã ví dụ chưa được chốt. Provider phải hỗ trợ geometry cho full route; không dùng response thành công giả khi capability không có.

Đề xuất response `data`:

```json
{
  "distanceMeters": 4000,
  "durationSeconds": 600,
  "vehicleType": "BIKE",
  "polyline": {
    "encoding": "encoded_polyline",
    "precision": 6,
    "value": "ENCODED_POLYLINE_FROM_PROVIDER"
  },
  "steps": [],
  "calculatedAt": "2026-10-06T02:00:00.000Z"
}
```

Polyline value là placeholder; runtime dùng precision 6. Nếu `includeSteps=true`, mỗi step có `distanceMeters`, `durationSeconds`, `streetName` nullable, `instruction` nullable và `maneuver` gồm `type`, `modifier` nullable, `location`, `exit` nullable. Adapter map maneuver, chưa có formatter tiếng Việt nên `instruction=null`. Mock trả fixture geometry và steps rỗng, không mô phỏng hướng dẫn thật. Attribution thuộc app hiển thị; xem [deploy](deploy.md).

## 4. R03 — POST /routes/matrix

Caller: Matching. Routing nhận điểm đón và profile loại xe cần tính, tự gọi Realtime Client lấy vị trí tài xế trong bán kính 2 km rồi tính ETA đến điểm đón. Request không nhận danh sách candidates/locations từ Matching. Matching đã triển khai lựa chọn/mời tuần tự, reservation và quyết định tài xế.

```json
{
  "pickup": {"lat": 10.7769, "lng": 106.7009},
  "vehicleType": "BIKE"
}
```

Application tạo deadline chung → gọi `RealtimeLocationPort.findNearbyDriverLocations(pickup, context)` với radius 2000 m → validate snapshot → batch OSRM Table với origins là vị trí driver, destination là pickup → map kết quả đúng driverId → trả response. Không sort theo ETA hoặc chọn tài xế thắng trong Routing.

Giữ driverId/location/observedAt từ Realtime qua mọi batch. Vị trí trùng driverId/sai schema làm dependency response lỗi. `MATRIX_MAX_CANDIDATES` giới hạn số vị trí xử lý trong một request; vượt giới hạn trả ROUTING_BUSY trước khi gọi OSRM, không cắt danh sách âm thầm. `vehicleType` chọn profile tính đường; danh sách vị trí không tự chứng minh loại xe hoặc khả năng nhận chuyến của driver. Matching kiểm tra eligibility trong luồng của mình sau.

Đề xuất `data`:

```json
{
  "entries": [
    {
      "driverId": "driver-a",
      "location": {"lat": 10.7700, "lng": 106.6900},
      "observedAt": "2026-10-06T02:00:00.000Z",
      "status": "OK",
      "distanceMeters": 1800,
      "durationSeconds": 240
    },
    {
      "driverId": "driver-b",
      "location": {"lat": 10.7800, "lng": 106.7100},
      "observedAt": "2026-10-06T02:00:00.000Z",
      "status": "NO_ROUTE",
      "distanceMeters": null,
      "durationSeconds": null
    }
  ],
  "radiusMeters": 2000,
  "hasReachableCandidate": true,
  "calculatedAt": "2026-10-06T02:00:00.000Z"
}
```

Realtime trả danh sách rỗng: HTTP 200 với `entries=[]`, `radiusMeters=2000`, `hasReachableCandidate=false`, calculatedAt; không gọi OSRM. HTTP 200 cũng áp dụng cho matrix hợp lệ kể cả tất cả entries NO_ROUTE. Entry OK yêu cầu đủ số đo; NO_ROUTE bắt buộc null, không dùng 0/Infinity. Giữ thứ tự snapshot Realtime.

Realtime lỗi/timeout/schema sai làm request thất bại; không trả empty list. Lỗi network/quota/schema của một OSRM batch hoặc shape sai trả lỗi toàn request v1; không đưa technical failure vào NO_ROUTE. OSRM NoTable/NoSegment ở cấp request trả 422 NO_ROUTE; chỉ map từng cell NO_ROUTE khi matrix Ok hợp lệ. Không có rank/winner/assignment trong response.

Batch size là minimum của MATRIX_BATCH_MAX_ELEMENTS và RATE_LIMIT_MATRIX_ELEMENTS_PER_MINUTE. Limiter kiểm tra budget khả dụng trước từng attempt; quá budget chờ hữu hạn hoặc lỗi, không âm thầm giảm snapshot. Giới hạn server/capability cần kiểm chứng và cấu hình batch phù hợp; không tự detect khi startup. Matrix là N×1, không mở NxM tùy ý.

Realtime lookup, queue, limiter, OSRM attempts/batches và aggregation cùng chia sẻ deadline 4 giây; không reset deadline sau khi nhận vị trí. R03 đã được triển khai với Realtime HTTP adapter thật và mock; estimate R01 của Trip giữ nguyên.

## 5. R04 — POST /routes/recalculate

Caller: Gateway, sau khi Gateway kiểm tra quyền của người dùng. Body:

```json
{
  "currentLocation": {"lat": 10.7790, "lng": 106.6990},
  "destination": {"lat": 10.7820, "lng": 106.6950},
  "vehicleType": "BIKE",
  "includeSteps": false
}
```

Response cùng RouteResult với R02. Không yêu cầu `tripId` vì Routing không đọc Trip DB hoặc xác nhận quyền trên Trip. Nếu muốn gắn Trip ID cho tracing, cần mở rộng DTO rõ ràng; không thêm field tự do trong request v1.

CurrentLocation trở thành origin; application dùng chung Calculate Route. Gateway/ứng dụng kiểm soát GPS/reroute frequency và bỏ response cũ khi request mới đã hoàn thành. Routing không PATCH chuyến, đổi giá quote hoặc tính tiền lại.

## 6. Lỗi đề xuất

| HTTP | Code | Trường hợp / retry |
| --- | --- | --- |
| 400 | INVALID_REQUEST | Tọa độ, ID/header/schema sai; không retry cùng payload |
| 400 | UNSUPPORTED_VEHICLE_TYPE | Mã xe không có allowlist/mapping |
| 401 | INVALID_SERVICE_CREDENTIAL | Caller token thiếu/sai |
| 403 | FORBIDDEN_OPERATION | Token hợp lệ nhưng không được gọi operation |
| 413 | INVALID_REQUEST | Body vượt 64 KiB |
| 422 | NO_ROUTE | Route/estimate/recalculate không tìm được tuyến; matrix dùng entry status |
| 422 | UNSUPPORTED_CAPABILITY | Mode không hỗ trợ matrix/geometry/steps theo request |
| 503 | ROUTING_BUSY | Queue đầy, snapshot Realtime vượt capacity matrix, job chờ quá budget hoặc limiter không cấp permit kịp |
| 503 | PROVIDER_UNAVAILABLE | Network/429/5xx provider sau retry hữu hạn |
| 503 | PROVIDER_CONFIGURATION_ERROR | Key/billing/auth provider không hợp lệ; không retry tự động |
| 503 | INVALID_PROVIDER_RESPONSE | Schema/đơn vị/index/geometry sai; không chấp nhận kết quả |
| 503 | REALTIME_UNAVAILABLE | Realtime network/service lỗi; không chuyển thành empty list |
| 503 | REALTIME_CONFIGURATION_ERROR | Endpoint/credential/auth Realtime sai |
| 503 | INVALID_REALTIME_RESPONSE | Danh sách/ID/tọa độ/timestamp/schema hoặc response size sai |
| 504 | REALTIME_DEADLINE_EXCEEDED | Timeout Realtime trước khi hết deadline request |
| 504 | ROUTING_DEADLINE_EXCEEDED | Deadline end-to-end hết; không để response đến sau deadline |
| 500 | INTERNAL_ERROR | Lỗi ngoài dự kiến, không trả stack trace/secret |

Có thể trả `Retry-After: 1` cho ROUTING_BUSY như gợi ý backoff; không coi đó là cam kết có quota sau một giây. Không trả nguyên body lỗi provider, key, URL query hay nội dung secret. Trip hiện ánh xạ mọi Routing failure thành `DEPENDENCY_UNAVAILABLE`; việc expose lỗi NO_ROUTE riêng cho khách cần thay đổi Trip contract ở feature khác.

Nếu deadline end-to-end đã hết, trả ROUTING_DEADLINE_EXCEEDED; REALTIME_DEADLINE_EXCEEDED dành cho timeout lookup khi request còn budget. Lỗi Realtime chỉ ảnh hưởng R03; estimate/full route/recalculate không gọi dependency vị trí.

## 7. OSRM adapter contract

Provider đã chọn OSRM; wire API tham chiếu [OSRM HTTP API](https://project-osrm.org/docs/v5.24.0/api/). Version deployment thực tế và algorithm phải được kiểm chứng trước real. Thiết kế adapter:

| Operation | Wire request đề xuất | Mapping |
| --- | --- | --- |
| Summary estimate | GET `/route/v1/{profile}/{lng1},{lat1};{lng2},{lat2}?alternatives=false&overview=false&steps=false` | Validate code Ok; lấy routes[0].distance/duration; làm tròn lên, check INT32; không geometry |
| Full route / recalculate | GET route cùng tọa độ với `alternatives=false&overview=full&geometries=polyline6&steps={true,false}` | Lấy route đầu, geometry precision 6; map legs/steps/maneuver khi được yêu cầu |
| Matrix batch N→1 | GET `/table/v1/{profile}/{coordinates}?sources=0;...;N-1&destinations=N&annotations=duration,distance` | Coordinates là N driver locations từ snapshot Realtime rồi pickup; validate durations/distances có N hàng, một cột; map row i về driverId i |

Không bật `fallback_speed`; không dùng đường chim bay cho cell không có đường. Cả duration/distance null → NO_ROUTE; một giá trị null và một số hoặc shape sai → INVALID_PROVIDER_RESPONSE. Adapter kiểm tra hàng/cột theo sources/destinations đã gửi, giữ mapping gốc qua batch.

Kiểm tra HTTP và code JSON; không coi HTTP 200 là đủ. `NoRoute`/`NoSegment` → NO_ROUTE; `NoTable` → NO_ROUTE cấp request; `NotImplemented` → UNSUPPORTED_CAPABILITY; `TooBig` → PROVIDER_CONFIGURATION_ERROR cần chỉnh batch/server limit; Invalid* sau input đã validate → PROVIDER_CONFIGURATION_ERROR. Unknown code/schema → INVALID_PROVIDER_RESPONSE. Network/429/5xx retry hữu hạn theo deadline; auth proxy 401/403 không retry. Không trả message provider nguyên văn.

Profile trong URL không tự chọn lại dataset đã build; mapping endpoint/profile ở [cấu hình](cau-hinh.md) phải được acceptance cho loại xe. Capability Table distance phải kiểm tra với version/algorithm đang deploy; không tự chạy N route fallback khi thiếu distance vì sẽ đổi tải/latency. Đã test wire bằng fixture và smoke OSRM CAR Hà Nội thật; xem osrm-ha-noi.md và báo cáo Matching. BIKE real vẫn cần profile đã kiểm chứng.

## 8. Realtime Client — outbound contract

Calculate ETA Matrix của Routing gọi Realtime Client lấy danh sách vị trí tài xế trong bán kính 2 km quanh pickup. Contract application: `findNearbyDriverLocations(center, context): Promise<DriverLocation[]>`, mỗi entry gồm driverId, location và observedAt. Radius v1 là 2000 m; empty list là thành công, lỗi dependency không được đổi thành empty list.

Method/path/envelope/auth HTTP thực tế của Realtime còn cần đối chiếu service đó. R03 dùng client này để lấy origins; giữ endpoint `/routes/matrix`, không thêm nearby endpoint. Luồng xử lý kết quả, lựa chọn và mời tài xế trong Matching thiết kế sau. Chi tiết DTO, lỗi, cấu hình và kiểm thử: [Realtime Client](realtime-client.md).
