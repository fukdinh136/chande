# API Driver Service

Hợp đồng theo controller/DTO/use case hiện tại. Base URL local http://localhost:3003, không prefix /api/v1. [Routes](routes.md), [Nghiệp vụ](nghiep-vu.md), [Deploy](deploy.md).

## 1. Quy ước

Business success: `{data,meta:{requestId}}`. Error: `{error:{code,message,details:[]},meta:{requestId}}`; hiện message bằng code. Health/JWKS trả object vận hành riêng. X-Request-Id UUID được phản hồi; Cache-Control no-store. Timestamp UTC ISO, field camelCase.

JWT DRIVER trên /drivers/me*. Actor lấy từ sub, không chấp nhận driverId/role trong body. Internal endpoints dùng X-Service-Token riêng, không dùng JWT thay credential. DTO whitelist + forbidNonWhitelisted, không truncate.

## 2. Auth

| Method/path | Body | Data |
| --- | --- | --- |
| POST /driver-auth/otp/request | {phoneNumber} | {challengeId,expiresIn,retryAfterSeconds} |
| POST /driver-auth/otp/verify | {phoneNumber,challengeId,otp} | Session |
| POST /driver-auth/refresh | {refreshToken} | Session mới, token cũ bị revoke |
| POST /driver-auth/logout | {refreshToken} | {loggedOut:true} |

Các endpoint trả 200. phoneNumber là số Việt Nam hợp lệ được chuẩn hóa mã 84; challengeId UUID, otp sáu chữ số. Không trả OTP, không tạo Driver mới.

Session: accessToken, tokenType Bearer, expiresIn, refreshToken, refreshExpiresAt và driver (Profile). Access mặc định 900 s; refresh mặc định 2.592.000 s. Logout idempotent với refresh không còn tồn tại/đã revoke nhưng input vẫn phải hợp lệ; không revoke access tức thì.

OTP sai/hết hạn/reuse → 401 AUTHENTICATION_FAILED. Rate limit → 429 RATE_LIMITED. Refresh sai/hết hạn/revoked → 401 INVALID_REFRESH_TOKEN. Legacy status → 409 DRIVER_STATUS_MIGRATION_REQUIRED; không tự xem ACTIVE/BLOCKED là hợp lệ.

## 3. Profile

GET /drivers/me trả:
```json
{
  "driverId": "40000000-0000-4000-8000-000000000001",
  "phoneNumber": "84912345678",
  "fullName": "Driver",
  "avatarUrl": null,
  "licenseNumber": "TEST-LICENSE",
  "desiredStatus": "OFFLINE",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

Ví dụ minh họa, không phải dữ liệu thật. PATCH nhận ít nhất một field fullName (1–100), avatarUrl (HTTPS URL tối đa 2048 ký tự hoặc null) hoặc licenseNumber (1–20); trả Profile. Đổi license cần OFFLINE/no active Trip. Không đổi phoneNumber/ID/password/status qua PATCH profile.

## 4. Vehicle

| Method/path | Request | Data |
| --- | --- | --- |
| GET /drivers/me/vehicles | Không body | {items:[Vehicle]} |
| GET /drivers/me/vehicles/:id | UUID của owner | Vehicle |
| POST /drivers/me/vehicles | vehicleType, licensePlate, brandModel, color | Vehicle, HTTP 201; Location /drivers/me/vehicles |
| PATCH /drivers/me/vehicles/:id | Ít nhất một trong bốn field trên hoặc isActive boolean | Vehicle |

Vehicle: vehicleId, driverId, vehicleType, licensePlate, brandModel, color, isActive, createdAt. vehicleType thuộc SUPPORTED_VEHICLE_TYPES, default BIKE/CAR_4/CAR_7; plate 1–15, brandModel 1–100, color 1–30. Tối đa MAX_VEHICLES mặc định 20, tính cả xe inactive.

POST active=true, không chọn xe. PATCH cần OFFLINE và không active Trip tại lần đọc; không phải assignment lock. Inactive xe chọn clear selection sau commit; cache lỗi không khôi phục active. Owner không khớp trả 404 RESOURCE_NOT_FOUND. Unique plate/license dựa constraint hiện có; conflict 409.

## 5. Selection và availability

PUT /drivers/me/selected-vehicle body `{vehicleId}`; chỉ owner/active, OFFLINE/no active Trip. GET /drivers/me/availability reconcile ý định PostgreSQL sang Redis. PUT /drivers/me/availability body `{desiredStatus:"ONLINE"|"OFFLINE"}`.

Ba route trả data:
```json
{
  "desiredStatus": "OFFLINE",
  "selectedVehicleId": null,
  "realtimeStatus": "UNKNOWN",
  "realtimeSync": "PENDING"
}
```

realtimeStatus: AVAILABLE/BUSY/OFFLINE/UNKNOWN; realtimeSync: APPLIED/PENDING. PENDING sau commit nghĩa là ý định đã lưu, Redis chưa xác minh; 200 không có nghĩa AVAILABLE. DB lỗi không trả success. OFFLINE không hủy chuyến và có thể giữ BUSY. Cache loss không tạo AVAILABLE.

## 6. Matching eligibility

GET /internal/drivers/:driverId/eligibility?vehicleType=BIKE; X-Service-Token bằng MATCHING_INBOUND_TOKEN.

Data: driverId, profileEligible, desiredStatus, vehicleId, reasons, driverSnapshot, vehicleSnapshot. Snapshot chỉ có khi hồ sơ/xe hợp lệ. driverSnapshot gồm fullName/avatarUrl; vehicleSnapshot gồm vehicleType/licensePlate/brand/color, với brand ánh xạ nguyên brand_model. ID nằm ngoài snapshot. Không phải reservation hoặc bảo đảm Trip đang rảnh.

## 7. Realtime batch eligibility

POST /internal/drivers/eligibility/batch; X-Service-Token bằng REALTIME_INBOUND_TOKEN, credential >=32 ký tự và khác Matching token. Không cấu hình credential thì route từ chối 401; không chặn toàn Driver.

```json
{
  "driverIds": ["40000000-0000-4000-8000-000000000001"],
  "vehicleType": "BIKE"
}
```

1–100 UUID unique, normalize lowercase, vehicleType optional. Data `{items:[{driverId,profileEligible,eligible,availabilityKnown,vehicleType,operationalStatus,reasons}]}`. Driver không tồn tại/legacy/OFFLINE là rejected có reasons; dependency lỗi toàn batch trả 503. ONLINE/hồ sơ/xe hợp lệ nhưng projection UNKNOWN trả availabilityKnown=false và eligible=false, Realtime không suy ra từ GPS.

## 8. Lỗi

| HTTP | Code tiêu biểu |
| --- | --- |
| 400 | INVALID_REQUEST |
| 401 | UNAUTHENTICATED, AUTHENTICATION_FAILED, INVALID_REFRESH_TOKEN, INVALID_SERVICE_CREDENTIAL |
| 403 | FORBIDDEN_ACTION |
| 404 | RESOURCE_NOT_FOUND |
| 409 | DRIVER_STATUS_MIGRATION_REQUIRED, LICENSE_NUMBER_CONFLICT, LICENSE_PLATE_CONFLICT, VEHICLE_ACTIVE_CONSTRAINT, VEHICLE_REQUIRED, VEHICLE_INACTIVE, PROFILE_INCOMPLETE, DRIVER_MUST_BE_OFFLINE, DRIVER_HAS_ACTIVE_TRIP, VEHICLE_LIMIT_REACHED |
| 429 | RATE_LIMITED; Retry-After 60 |
| 503 | DEPENDENCY_UNAVAILABLE; Retry-After 1 |
| 500 | INTERNAL_ERROR |

Không trả query, OTP, token hoặc secret trong lỗi. Schema/startup failure chỉ có thông báo chung; readiness 503 không chỉ ra nội dung dữ liệu legacy.

## 9. Trip, Realtime và Gateway chính thức

Trip public routes thuộc Trip Service: GET /trips/active, /trips/history, /trips/:id; PATCH /trips/:id/status; POST /trips/:id/cancel. Dùng JWT DRIVER và version/Idempotency-Key theo [Trip API](../../trip-service/docs/api.md). Không API nội bộ tra driverId hoặc credential service thay user JWT.

Trip status CREATED/SEARCHING/ASSIGNED/DRIVER_ARRIVED/IN_PROGRESS/COMPLETED/CANCELLED. Code Trip hiện dùng Idempotent-Replay, tài liệu Trip dùng Idempotency-Replayed; App TripClient đọc cả hai, vẫn giữ version mới hơn. Contract chung còn cần owner xác nhận; Driver không sửa Trip.

GPS: namespace /realtime, auth.token, event driver.location.update với latitude/longitude/accuracy/recordedAt; xem [Realtime API](../../realtime-service/docs/api.md). Không có socket offer/trip notification trong Driver.

Gateway chính thức cần proxy nguyên contract/headers và bảo vệ internal routes. Optional forward-IP credential không phải Driver JWT. Không dùng Gateway làm nguồn dữ liệu Trip hoặc ACK bền vững cho sự kiện đang lưu bộ nhớ.
