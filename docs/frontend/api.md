# API frontend và contract adapters

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Customer App / Driver App |
| Rà soát | 2026-10-06 |
| Quy ước | [Format và số liệu](../quy-uoc-tai-lieu.md) |

## Trạng thái thực thi hiện tại

Các mô tả dưới đây là thiết kế đích. Đã triển khai từng phần kết nối trong app/; trạng thái, commit, kiểm thử và giới hạn APK/native được ghi tại [báo cáo thực thi](bao-cao-ket-noi.md). Shared-source Android variants hiện dùng com.chande.customer/com.chande.driver; workspace mobile riêng vẫn là đề xuất.

Đây là contract client thiết kế dựa controller/schema backend đã có. Không thêm public BFF trong đợt thiết kế. HTTP path trong các bảng đã gồm /api/v1; BASE_ORIGIN chỉ scheme/host/port, không thêm /api/v1 lần hai. WebSocket dùng cùng origin với path riêng.

## Truy cập và dữ liệu

Docker host ingress 127.0.0.1:18080; Kubernetes port-forward host 127.0.0.1:18081. Android emulator dùng alias host 10.0.2.2, cần kiểm thiết bị trong spike; 127.0.0.1 trong emulator là emulator. Máy thật có thể dùng adb reverse port tương ứng, rồi trỏ localhost trên thiết bị; không đổi các service sang public IP chỉ để test. HTTP cleartext là cấu hình debug-only cần native build kiểm chứng; release chọn HTTPS.

```text
EXPO_PUBLIC_BACKEND_ORIGIN=http://10.0.2.2:18080
EXPO_PUBLIC_MAP_STYLE_URL=<style.json có coverage Hà Nội>
EXPO_PUBLIC_ENABLED_VEHICLE_TYPES=CAR_4,CAR_7
EXPO_PUBLIC_NATIVE_NAVIGATION_ENABLED=false   # bật sau spike + rich route gate
```

Những biến này chỉ là proposal tên config; chưa loader nào đọc chúng. Chỉ public style key có restriction phù hợp được bundle nếu provider cần. Không đưa RABBITMQ_URL, DATABASE_URL, X-Service-Token, OSRM internal host hoặc PEM trong EXPO_PUBLIC/app assets. Chỉ access JWT của account được gửi Authorization.

| Service | Success decoder | Error decoder |
| --- | --- | --- |
| User v2 | Raw object/array; 204 empty body | `{code,message,fieldErrors?}` |
| Driver/Trip/Matching/Routing | `{data,meta:{requestId}}` | `{error:{code,message,details?},meta}` |
| Gateway own errors | Không coi là business data | Error/meta theo Gateway |

Request X-Request-Id UUID; Idempotency-Key UUID chỉ các actions có contract. Không blanket retry every POST. Mỗi endpoint validate schema; unknown/malformed response là CONTRACT_ERROR, không đổi thành empty success. Client normalize Error `{service,code,httpStatus,requestId?,fieldErrors?,retryAfterSeconds?,causeKind}`. Không log body PII, password/OTP/token/GPS.

Tiền decimal string VND, giữ nguyên qua layer; meter/second numbers, timestamps UTC, lat/lng số. BigInt hoặc decimal-string formatter tránh Number overflow; có test >2^53. Tọa độ outbound theo Routing bounds ±85.0511 latitude/±180 longitude; GeoJSON/native Map dùng [lng,lat], API object {lat,lng} hoặc GPS latitude/longitude theo endpoint.

## Customer endpoints hiện có

| Client method | HTTP | Body/query | Kết quả wire / auth |
| --- | --- | --- | --- |
| register | POST /api/v1/auth/register | phoneNumber,password,fullName | 201 raw RegisteredUser; public |
| login | POST /api/v1/auth/login | phoneNumber,password | 200 raw TokenResponse; public |
| refresh | POST /api/v1/auth/refresh | refreshToken | 200 raw tokens rotated; public |
| logout / logoutAll | POST /api/v1/auth/logout; /logout-all | refreshToken cho logout; logout-all không body | 204; logout-all RIDER |
| get/updateProfile | GET/PATCH /api/v1/users/me | PATCH fullName/avatarUrl theo User schema | 200 raw UserProfile; RIDER |
| changePassword | POST /api/v1/users/me/password | oldPassword,newPassword | 200 raw `{passwordChanged:true}`; thu hồi refresh sessions, không token mới |
| listPlaces | GET /api/v1/users/me/addresses | Không actor/query | 200 raw Address[] |
| createPlace | POST /api/v1/users/me/addresses | label,addressText,lat,lng,makeDefault | 201 raw Address; max10 |
| updatePlace | PUT /api/v1/users/me/addresses/:addressId | AddressBody theo User, không gửi isDefault response field | 200 raw Address |
| default/deletePlace | PUT /api/v1/users/me/addresses/:addressId/default; DELETE /:id | Không body | Default 200 Address; delete 204 |

Address có id,label,addressText,lat,lng,isDefault,createdAt. Luôn đúng một default khi không rỗng. Customer backend không hỗ trợ email/OTP/reset/social auth; màn login dùng phone/password. Đổi password thành công clear own session/cache và trở về login; không tự giữ phiên với refresh đã revoke.

## Driver endpoints hiện có

| Client method | HTTP | Body/query | Data / auth |
| --- | --- | --- | --- |
| requestOtp | POST /api/v1/driver-auth/otp/request | phoneNumber | 200 challengeId,expiresIn,retryAfterSeconds; public |
| verifyOtp | POST /api/v1/driver-auth/otp/verify | phoneNumber,challengeId,otp | 200 access/refresh/expiresIn/refreshExpiresAt/driver; public |
| refresh/logout | POST /api/v1/driver-auth/refresh; /logout | refreshToken | 200 Session / loggedOut; không User decoder |
| get/updateProfile | GET/PATCH /api/v1/drivers/me | PATCH fullName/avatarUrl/licenseNumber | 200 Profile; DRIVER |
| list/getVehicles | GET /api/v1/drivers/me/vehicles; /:id | Không actor | 200 `{items:[Vehicle]}` / Vehicle |
| create/updateVehicle | POST /api/v1/drivers/me/vehicles; PATCH /:id | vehicleType,licensePlate,brandModel,color; PATCH thêm isActive | 201 / 200 Vehicle |
| selectVehicle | PUT /api/v1/drivers/me/selected-vehicle | vehicleId | 200 Availability; OFFLINE/no active/reservation |
| get/setAvailability | GET/PUT /api/v1/drivers/me/availability | PUT desiredStatus ONLINE/OFFLINE | 200 desiredStatus,selectedVehicleId,realtimeStatus,realtimeSync |

OTP chỉ account đã được cấp; local 123456 là fixture, không app auth bypass. VehicleType driver BIKE/CAR_4/CAR_7 nhưng demo booking/nav backend chỉ CAR_4/CAR_7. UI không suy registered vehicle thành selected; thiếu Redis selection cần chọn lại. Profile/vehicle editing policy giữ OFFLINE và ràng buộc busy; 200 intent + PENDING không báo đã sẵn sàng nhận xe.

## Trip dùng chung, quyền theo role

| Method | HTTP | Body/query | Kết quả |
| --- | --- | --- | --- |
| estimate (Customer) | POST /api/v1/trips/estimate | pickup,destination,vehicleType | 200 Quote: quoteId, route,fare,createdAt,expiresAt |
| create (Customer) | POST /api/v1/trips | quoteId; Idempotency-Key | 201 Trip SEARCHING; replay cùng key/body |
| active | GET /api/v1/trips/active | Không rider/driver ID | 200 Trip hoặc null của JWT owner/assigned driver |
| history | GET /api/v1/trips/history | limit1–100 default20; cursor opaque; status COMPLETED/CANCELLED optional | 200 `{items,nextCursor}`; không month/date-filter/aggregate |
| detail | GET /api/v1/trips/:tripId | UUID | 200 `{trip,statusHistory}` |
| update (Driver) | PATCH /api/v1/trips/:tripId/status | status DRIVER_ARRIVED/IN_PROGRESS/COMPLETED,version; Idempotency-Key | 200 Trip; đúng driver/transition/version |
| cancel | POST /api/v1/trips/:tripId/cancel | reason1–500,version; Idempotency-Key | 200 CANCELLED, trước IN_PROGRESS; không phí/tìm lại |

Trip DTO lấy từ [schema](../../service/trip-service/src/api/schemas.ts), không tự flatten detail/history sai shape. Driver/vehicle snapshots nullable trước ASSIGNED; driver có fullName/avatarUrl/driverId, không phone/rating. fare.estimatedAmount string, finalAmount chỉ COMPLETED; cancellation final null. Completed là trạng thái chuyến, không phải payment settled.

```json
{
  "pickup": {"lat": 21.0285, "lng": 105.8542, "address": "Điểm đón Hà Nội"},
  "destination": {"lat": 21.0272, "lng": 105.8355, "address": "Điểm trả Hà Nội"},
  "vehicleType": "CAR_4"
}
```

Ví dụ request estimate; quote được server giữ 300000 ms, chỉ RIDER đó dùng một lần. Dữ liệu địa chỉ là minh họa, không reverse-geocode output. Route.preview không thay quote.route/fare; rebook điền điểm rồi estimate mới, không reuse quote/trip ID lịch sử.

## Matching — Driver only

| Method | HTTP | Kết quả |
| --- | --- | --- |
| activeOffer | GET /api/v1/matching/offers/active | 200 offer hoặc null; có thể status ASSIGNMENT_PENDING/ASSIGNED |
| offer | GET /api/v1/matching/offers/:offerId | 200 chính driver được mời; 403 khác owner |
| accept | POST /api/v1/matching/offers/:offerId/accept | body {}; UUID Idempotency-Key; 202 quyết định lưu, chưa Trip assigned |
| decline | POST /api/v1/matching/offers/:offerId/decline | body {}; UUID Idempotency-Key; 200 DECLINED |

Offer statuses PENDING, ASSIGNMENT_PENDING, ASSIGNED, DECLINED, EXPIRED, REJECTED, REVOKED. View model đóng pending card theo state/current expiresAt; khi ASSIGNMENT_PENDING không giải phóng UI/reservation dựa timer offer. Wrong owner 403, not found404, closed/key conflict409. Retry cùng key nhận receipt có thể cũ: luôn reconcile current offer/Trip.

```json
{
  "offerId": "80000000-0000-4000-8000-000000000001",
  "tripId": "20000000-0000-4000-8000-000000000001",
  "driverId": "10000000-0000-4000-8000-000000000004",
  "version": 1,
  "status": "PENDING",
  "expiresAt": "2026-10-06T02:00:20.000Z",
  "pickup": {"lat": 21.0285, "lng": 105.8542},
  "destination": {"lat": 21.0272, "lng": 105.8355},
  "vehicleType": "CAR_4",
  "fare": {"currency": "VND", "amount": "27460"}
}
```

Shape data offer, không full envelope. timestamp là fixture phải thay khi test. Không có rider identity/note, route, pickup ETA/net earnings. Nếu tính pickup preview thì GET position local + POST routes, label “Ước tính đường đi”, không blocker nhận cuốc.

## Routes preview đã có; Navigation draft tách riêng

| API | Input | Output / hành vi |
| --- | --- | --- |
| POST /api/v1/routes | origin,destination,vehicleType,includeSteps boolean | distanceMeters,durationSeconds,polyline{encoding,precision6,value},steps,calculatedAt |
| POST /api/v1/routes/recalculate | currentLocation,destination,vehicleType,includeSteps | Cùng RouteResult, không tripId và không đổi giá |

Gateway verify RIDER/DRIVER và inject token Routing; mobile không X-Service-Token. Estimate Trip trả summary, không geometry: xin R02 khi cần draw route, không tự dựng polyline từ distance. Một request mỗi purpose/inputRevision, debounce proposal500ms; abort old UI fetch nhưng vẫn discard late response theo revision. Không recalculate mỗi GPS tick; native offRoute policy ở tài liệu maps.

R05 navigation là **DRAFT** khác preview, chưa frontend/backend implementation: [contract gap](maplibre-navigation.md). Chỉ bật capability khi rich legs/step geometry và native parse/progress/reroute đã kiểm. Không gọi OSRM private hoặc gửi bearer user vào map server thay Routing.

## Hai kênh realtime

| Kênh | Auth / message | Consumer frontend |
| --- | --- | --- |
| Raw WebSocket BASE_ORIGIN/ws | Send `{type:"auth",token}` trong10s; auth.ok; ping/pong ~25s; trip.event có event envelope | Cả hai app; invalidate/refetch Trip đúng role; auth expired reconnect bằng token mới |
| Socket.IO namespace /realtime, path /socket.io/, websocket transport | auth.token DRIVER; driver.location.update với ACK; driver.trip.offer / updated `{data:offer}` | Driver only; một socket cho GPS/offers |

Không dùng /ws location.update cho GPS: implementation Gateway vẫn logging. Không tạo room do mobile chỉ định. Offer/trip notifications foreground không là push hoặc delivery receipt thiết bị.

```json
{
  "latitude": 21.0295,
  "longitude": 105.8542,
  "accuracy": 5,
  "recordedAt": "2026-10-06T02:00:00.000Z"
}
```

GPS gửi raw sample mới, không driverId/vehicleType/speed/bearing trong wire payload. ACK data accepted/disposition/recordedAt/receivedAt hoặc error/meta. Offline/new sample queue không replay vị trí cũ; recordedAt không đổi sang Date.now để giả freshness. SDK progress snapped position không phải raw GPS report.

Frontend interfaces đề xuất: CustomerAuthApi/DriverAuthApi, CustomerProfileApi, DriverProfileApi, VehiclesApi, AvailabilityApi, TripApi, OfferApi, PreviewRoutesApi, TripEventPort, DriverRealtimePort. NativeNavigationPort và NavigationRoutePort tách contract DRAFT khỏi APIs đã có. Shared interfaces không quyết định authorization: backend vẫn verify role/owner.

## Error/recovery UI

401: refresh single-flight đúng realm tối đa một lần; issuer/aud/config failure không infinite rotate. 403: không có quyền, không retry. 404: resource không tồn tại/không được xem; clear only cache đúngresource sau reconcile. 409: state/key/version conflict, đọc lại trước hành động mới. 429: countdown Retry-After. 503/network: show stale/unknown, bounded retry; không báo active/AVAILABLE/assigned giả. 204: empty success. Mọi request cancel sau logout/session epoch cũ không được repopulate cache/token.
