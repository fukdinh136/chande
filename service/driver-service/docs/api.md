# API Driver Service

Ngày 05/10/2026. Contract 0.1 draft để review; chưa có controller/OpenAPI chạy được. [Nghiệp vụ](nghiep-vu.md), [Kiến trúc](kien-truc.md), [Routes](routes.md), [Deploy](deploy.md).

## 1. Quy ước chung và identity

Local Driver đề xuất http://localhost:3003; chọn port khác Trip API 3001/worker 3002. Route public Gateway thêm /api/v1 và bỏ prefix khi proxy. Không khẳng định Gateway đã dùng port/prefix này.

JSON UTF-8; UUID string; timestamp UTC ISO8601; boolean phải là JSON boolean. Unknown field bị từ chối. X-Request-Id UUID tùy chọn, server sinh nếu thiếu. Thành công: {data, meta:{requestId}}; lỗi: {error:{code,message,details:[]}, meta:{requestId}}. API chứa dữ liệu cá nhân/token trả Cache-Control: no-store. Health và JWKS/OpenAPI không dùng envelope nghiệp vụ.

JWT DRIVER: sub UUID, role DRIVER, iss/aud/exp/iat được kiểm tra. Không tin X-Driver-Id hoặc driverId body. Chốt một issuer/JWKS chung được cả User và Driver dùng qua auth issuer, hoặc sửa cấu hình verifier Trip để hỗ trợ nhiều issuer một cách tường minh. Baseline đề xuất Driver ký token có audience chứa driver-service và trip-service; Gateway/Matching audience chỉ thêm khi nhóm chốt. Trip kiểm tra audience trip-service. Không tự coi hai issuer đã được Trust chỉ vì cùng claim role.

D01/D02 công khai nhưng có rate limit; D03/D04 chứng minh quyền bằng refresh token; D05–D12 dùng JWT DRIVER; I01 dùng X-Service-Token riêng của Matching, không chấp nhận JWT người dùng thay thế.

## 2. Models

| Model | Trường |
| --- | --- |
| DriverProfile | driverId, phoneNumber canonical, fullName (1–100), avatarUrl HTTPS hoặc null, licenseNumber (1–20), desiredStatus ONLINE/OFFLINE, createdAt, updatedAt |
| Vehicle | vehicleId, vehicleType (mã chung ≤20), licensePlate (≤15), brandModel (≤100), color (≤30 hoặc null theo DDL), isActive boolean, createdAt |
| Availability | desiredStatus, selectedVehicleId UUID/null, realtimeStatus AVAILABLE/BUSY/OFFLINE/UNKNOWN, realtimeSync APPLIED/PENDING |
| Session | accessToken, tokenType Bearer, expiresIn integer giây, refreshToken, refreshExpiresAt, driver: DriverProfile |

Không trả password_hash/token_hash/revoked_at trong profile hoặc snapshot. Những trường nullable phải kiểm tra DDL trước triển khai. Không trả vehicles.updatedAt vì không có cột này. UNKNOWN là giá trị response khi không biết cache, không phải thêm enum/cột trong DB.

SĐT input mẫu +84912345678 hoặc 84912345678 → canonical 84912345678. Không nhận 0912345678 rồi đoán quốc gia. Nếu muốn hỗ trợ định dạng nội địa, cần chốt countryCode và normalization riêng. License plate trim/uppercase; chính sách bỏ dấu cách/gạch phải chốt trước kiểm tra unique. Không âm thầm cắt dài.

## 3. D01 — POST /driver-auth/otp/request

```json
{"phoneNumber":"+84912345678"}
```

200:
```json
{
  "data": {
    "challengeId":"10000000-0000-4000-8000-000000000001",
    "expiresIn":300,
    "retryAfterSeconds":60
  },
  "meta":{"requestId":"90000000-0000-4000-8000-000000000001"}
}
```

300/60 giây là default đề xuất. Response giống nhau với SĐT chưa đăng ký; challenge không cho suy ra tài khoản. Provider failure trả 503 theo chính sách đồng nhất, không dùng phản hồi khác nhau để xác nhận account. 429 khi rate limit theo SĐT/IP; có Retry-After. Production không trả code OTP. Mock local dùng mã qua cấu hình/dev console riêng, không ghi code trong response contract chính.

## 4. D02 — POST /driver-auth/otp/verify

```json
{
  "phoneNumber":"84912345678",
  "challengeId":"10000000-0000-4000-8000-000000000001",
  "otp":"123456"
}
```

Mã trong ví dụ chỉ minh họa. Challenge gắn phone và purpose LOGIN. Đề xuất OTP 6 chữ số, tối đa 5 lần sai/challenge; consume một lần bằng adapter. 200 data: Session. OTP sai/hết hạn/đã dùng hoặc tài khoản không đủ điều kiện: 401 AUTHENTICATION_FAILED, không phân biệt account tồn tại. Không tạo drivers mới. Nếu DB lỗi sau consume, 503; người dùng có thể cần request OTP mới. Không hứa replay cùng Session từ challenge đã tiêu thụ.

## 5. D03/D04 — phiên

POST /driver-auth/refresh và POST /driver-auth/logout nhận:
```json
{"refreshToken":"opaque-token-placeholder"}
```

Refresh 200 data: Session mới. Token entropy cao chỉ lưu hash, kiểm tra expires_at/revoked_at. Transaction rotate một lần; sai/hết hạn/revoked trả 401 INVALID_REFRESH_TOKEN. Hai refresh cùng token chỉ một thành công; token cũ không dùng lại. Không có token-family column để hứa revoke toàn bộ family khi reuse.

Logout 200 data:{loggedOut:true}, kể cả token đã revoke/không tồn tại với body hợp lệ; token được revoke chỉ là token cung cấp, không logout mọi thiết bị. Access token cũ vẫn có thể dùng đến expiry; không hứa logout lập tức trên mọi service. App đóng socket và bỏ token sau logout.

## 6. D05/D06 — GET/PATCH /drivers/me

GET 200 data: DriverProfile. PATCH nhận tập con không rỗng:
```json
{"fullName":"Kiều Nhật Minh","avatarUrl":null,"licenseNumber":"LICENSE001"}
```

Chỉ ba field này; licenseNumber không null/rỗng, avatarUrl null chỉ khi DDL cho phép. Không cho đổi phoneNumber/status/id/password qua PATCH này. 200 profile mới; 409 LICENSE_NUMBER_CONFLICT khi trùng, không tiết lộ owner. licenseNumber thay đổi yêu cầu OFFLINE và không có active Trip như thay đổi định danh xe. fullName/avatarUrl cập nhật không sửa snapshot chuyến đã lưu.

## 7. D07/D08 — GET/POST /drivers/me/vehicles

GET 200 data:{items:[Vehicle]}; danh sách xe cá nhân, đề xuất tối đa 20 xe/tài xế ở tầng nghiệp vụ để response không vô hạn (cần review). POST:
```json
{
  "vehicleType":"VEHICLE_TYPE_CODE",
  "licensePlate":"30A-12345",
  "brandModel":"Toyota Vios",
  "color":"Trắng"
}
```

VEHICLE_TYPE_CODE là placeholder của danh mục chưa chốt, không enum mặc định. Server gán driver_id từ JWT, UUID, is_active=true và created_at. 201 data:Vehicle, Location trỏ /drivers/me/vehicles (route danh sách hiện có). Chưa tự chọn xe hoặc online. 409 LICENSE_PLATE_CONFLICT/VEHICLE_LIMIT_REACHED. Không có Idempotency-Key receipt Driver; nếu mất response, GET list và đối chiếu biển số, không coi retry 409 là một lần tạo khác thành công.

## 8. D09 — PATCH /drivers/me/vehicles/:vehicleId

Body là tập con không rỗng của vehicleType/licensePlate/brandModel/color/isActive. Không nhận driverId/id/createdAt/updatedAt. Mọi cập nhật xe baseline yêu cầu OFFLINE và GET Trip active=null. 200 Vehicle; 404 xe không thuộc mình/không tồn tại; 409 DRIVER_MUST_BE_OFFLINE/DRIVER_HAS_ACTIVE_TRIP hoặc unique conflict; 503 khi chưa xác minh được Trip.

Nếu vô hiệu hóa xe đang chọn, clear vehicle_id/loại ứng viên theo adapter; DB commit rồi Redis lỗi không rollback giả. Lần GET availability phải phát hiện xe inactive và trả không khả dụng. Chưa có endpoint DELETE.

## 9. D10 — PUT /drivers/me/selected-vehicle

```json
{"vehicleId":"50000000-0000-4000-8000-000000000001"}
```

Yêu cầu OFFLINE, đúng owner, xe active và active Trip=null. 200 data:Availability. Redis lỗi thì 503 và không báo chọn xe thành công. Gọi lại cùng ID đặt cùng selection; không lưu bền vững selection trong PostgreSQL. Bật ONLINE sau đó là lệnh riêng. Không tự đổi xe phục vụ chuyến hiện tại.

## 10. D11/D12 — GET/PUT /drivers/me/availability

PUT:
```json
{"desiredStatus":"ONLINE"}
```

OFFLINE dùng cùng DTO với giá trị OFFLINE, không dùng toggle. ONLINE cần hồ sơ và xe chọn hợp lệ; OFFLINE luôn cho phép lưu ý định kể cả Trip đang lỗi/đang chạy.

200 sau DB commit, kể cả cache đang chờ đồng bộ:
```json
{
  "data":{
    "desiredStatus":"ONLINE",
    "selectedVehicleId":"50000000-0000-4000-8000-000000000001",
    "realtimeStatus":"UNKNOWN",
    "realtimeSync":"PENDING"
  },
  "meta":{"requestId":"90000000-0000-4000-8000-000000000002"}
}
```

Không đủ xe/hồ sơ: 409 VEHICLE_REQUIRED/VEHICLE_INACTIVE/PROFILE_INCOMPLETE trước commit. Redis không thể đọc để validate ONLINE: 503 trước commit. DB commit nhưng projection write lỗi: 200 PENDING, không trả lỗi ngụ ý dữ liệu chưa lưu. realtimeStatus=BUSY có thể đi cùng desiredStatus=OFFLINE. GET không đủ cache trả UNKNOWN, không đoán AVAILABLE.

Chưa có version column: không nhận expectedVersion giả. DB serialize status writes; client đọc lại sau xung đột mạng, không coi response đến sau luôn là trạng thái mới nhất. Last committed write là baseline, không optimistic locking xuyên mọi field.

## 11. I01 — GET /internal/drivers/:driverId/eligibility

Chỉ Matching được cấp credential. Query vehicleType bắt buộc (mã chung tối đa 20). Đọc hồ sơ, xe chọn và status nhất quán trong giới hạn nguồn dữ liệu. 200:
```json
{
  "data":{
    "driverId":"40000000-0000-4000-8000-000000000001",
    "profileEligible":true,
    "desiredStatus":"ONLINE",
    "vehicleId":"50000000-0000-4000-8000-000000000001",
    "reasons":[],
    "driverSnapshot":{"fullName":"Tài xế minh họa","avatarUrl":null},
    "vehicleSnapshot":{
      "vehicleType":"VEHICLE_TYPE_CODE",
      "licensePlate":"30A-12345",
      "brand":"Toyota Vios",
      "color":"Trắng"
    }
  },
  "meta":{"requestId":"90000000-0000-4000-8000-000000000003"}
}
```

profileEligible chỉ nói về hồ sơ/ý định/xe tại thời điểm đọc. KHÔNG bảo đảm presence mới, không có reservation hoặc không có active Trip; không phải assignment lease. Matching kiểm tra các điều kiện của mình và Trip kiểm tra active constraint cuối cùng. profileEligible=false có reasons DRIVER_OFFLINE/VEHICLE_REQUIRED/VEHICLE_INACTIVE/VEHICLE_TYPE_MISMATCH/PROFILE_INCOMPLETE; snapshot chỉ trả khi true, nếu false trả null. 404 driver không tồn tại; 503 dependency đọc không xác định. Không trả licenseNumber, SĐT, mật khẩu hoặc token cho Matching nếu không cần.

Snapshot field brand lấy nguyên brand_model, không suy đoán brand. API này là mới đề xuất của Driver; Matching cần xác nhận trước gọi.

## 12. Hợp đồng Trip phải giữ nguyên

| Nhu cầu Driver App | API tại Trip | Quy tắc quan trọng |
| --- | --- | --- |
| Lấy chuyến active | GET /trips/active | JWT DRIVER; data TripDTO hoặc null |
| Lịch sử | GET /trips/history | data.items/nextCursor; chỉ chuyến của mình |
| Chi tiết | GET /trips/:id | data.trip + statusHistory |
| Đến điểm đón | PATCH /trips/:id/status | status DRIVER_ARRIVED, version hiện thấy, Idempotency-Key |
| Bắt đầu | PATCH /trips/:id/status | status IN_PROGRESS, version, key mới cho hành động mới |
| Hoàn thành | PATCH /trips/:id/status | status COMPLETED, version, key |
| Hủy | POST /trips/:id/cancel | reason + version + key; chỉ trước IN_PROGRESS |

Body ví dụ gửi đến Trip, không phải Driver:
```json
{"status":"DRIVER_ARRIVED","version":2}
```

Retry lỗi mạng dùng cùng key và body; sau 409 đọc lại và hành động mới dùng key mới. Trip DTO có tiền VND dạng chuỗi; COMPLETED không có nghĩa PAID. Không thêm route Driver alias cập nhật Trip để tạo hai nguồn nghiệp vụ.

Driver TripActiveClient có thể gọi GET /trips/active bằng JWT người dùng đã xác minh và chuyển tiếp; không dùng X-Service-Token để chọn tài xế tùy ý. Internal GET /internal/trips/... theo driverId CHƯA có trong tài liệu Trip, không nằm baseline. Không lưu token để poll nền.

Matching (không phải Driver) gọi POST /internal/trips/:id/assignment với eventId, driverId, vehicleId, driverSnapshot, vehicleSnapshot đúng contract Trip. 200 callback là đã commit; ACK replay không khẳng định Trip hiện vẫn ASSIGNED.

## 13. Event Trip và realtime

Giữ nguyên schemaVersion/type/tripVersion của tài liệu nhóm, không đổi sang eventType/aggregateVersion/.v1 tự đặt:
```json
{
  "schemaVersion":1,
  "eventId":"60000000-0000-4000-8000-000000000001",
  "type":"trip.assigned",
  "tripId":"20000000-0000-4000-8000-000000000001",
  "tripVersion":2,
  "occurredAt":"2026-10-05T02:02:00Z",
  "data":{
    "riderId":"30000000-0000-4000-8000-000000000001",
    "driverId":"40000000-0000-4000-8000-000000000001",
    "status":"ASSIGNED"
  }
}
```

Các type: trip.searching, trip.assigned, trip.driver_arrived, trip.started, trip.completed, trip.cancelled. Trip gửi POST /internal/events/trips tới Gateway và Notification; 202 theo contract nghĩa đã lưu bền vững, không phải đã emit socket. Gateway cần storage/receipt riêng để đáp ứng; không thể dùng bộ nhớ tạm rồi ACK như durable. Driver không nhận event trực tiếp và không phát Driver domain event bền vững trong baseline schema cố định.

Event không có vehicleId. Không đặt vehicle_id từ payload không tồn tại; sau reconnect app GET active để lấy đầy đủ. Version chỉ so trong cùng tripId; event terminal của chuyến cũ không được clear BUSY của chuyến mới. Gateway cần biết current trip hoặc read/resync phù hợp; không tự tạo field trong Driver Redis mà gọi là ERD đã có. Contract lưu trạng thái đối soát của Gateway/Matching còn phải chốt.

WebSocket names/offer routes/presence chưa có trong ZIP, không khẳng định có sẵn. Đề xuất nhóm chốt danh tính socket, room, ack, heartbeat, freshness và payload trước triển khai. UI có thể poll API active/chi tiết khi socket chưa tích hợp, không coi polling là GPS realtime.

## 14. Idempotency và mã lỗi

Driver không có request_receipts nên không dùng hợp đồng replay như Trip. PUT đặt cùng ý định/selection có thể lặp về tác dụng mong muốn nhưng không replay nguyên response. POST vehicle dùng unique plate và read-back khi mất response. Refresh rotate có thể yêu cầu login lại nếu response mất. Logout có tính idempotent. Không yêu cầu Idempotency-Key ở các route Driver rồi bỏ qua nó trong implementation.

| HTTP | Code | Ý nghĩa |
| --- | --- | --- |
| 400 | INVALID_REQUEST | DTO/path/query/unknown field sai |
| 401 | AUTHENTICATION_FAILED / UNAUTHENTICATED | OTP/tài khoản hoặc JWT không hợp lệ |
| 401 | INVALID_REFRESH_TOKEN / INVALID_SERVICE_CREDENTIAL | Token phiên hoặc credential nội bộ sai |
| 403 | FORBIDDEN_ACTION | Role không có quyền |
| 404 | RESOURCE_NOT_FOUND | Không tồn tại hoặc không sở hữu resource |
| 409 | LICENSE_PLATE_CONFLICT / LICENSE_NUMBER_CONFLICT | Unique conflict |
| 409 | VEHICLE_REQUIRED / VEHICLE_INACTIVE / PROFILE_INCOMPLETE | Chưa đủ điều kiện online |
| 409 | DRIVER_MUST_BE_OFFLINE / DRIVER_HAS_ACTIVE_TRIP | Không được sửa/chọn lúc hiện tại |
| 409 | VEHICLE_LIMIT_REACHED | Đạt giới hạn đề xuất |
| 429 | RATE_LIMITED | OTP/auth quá tần suất |
| 503 | DEPENDENCY_UNAVAILABLE | DB/Redis/Trip/provider cần cho thao tác không sẵn sàng |
| 500 | INTERNAL_ERROR | Lỗi không dự kiến, không trả stack/secret |

## 15. Điểm phải xác nhận trước code

JWT trust nhiều service; DDL nullable/status hiện tại; tập mã xe ≤20; field mapping snapshot; giới hạn số xe; OTP TTL/cooldown/maxAttempts; policy mất response refresh; race OFFLINE/accept/sửa xe; ownership state và cache freshness; gateway durable receipt; onboarding tài xế. Trip route/event hiện là draft, mock phải giữ nguyên contract để không tạo tích hợp giả.
