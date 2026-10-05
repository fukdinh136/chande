# Routes Driver Service

| Thuộc tính | Giá trị |
| --- | --- |
| Service | driver-service |
| Rà soát | 2026-10-06 |
| Quy ước | [Format và số liệu](../../../docs/quy-uoc-tai-lieu.md) |

Driver trực tiếp không có global prefix. Path Gateway chính thức phải được xác nhận trước khi bật gateway mode trong app. [API](api.md), [Deploy](deploy.md).

## Routes hiện có

| Method | Path | Caller/authentication | Controller → use case |
| --- | --- | --- | --- |
| POST | /driver-auth/otp/request | Public, OTP adapter rate limit | AuthController → auth.request |
| POST | /driver-auth/otp/verify | Challenge + OTP | AuthController → auth.verify |
| POST | /driver-auth/refresh | Opaque refresh token | AuthController → auth.refresh |
| POST | /driver-auth/logout | Opaque refresh token | AuthController → auth.logout |
| GET | /drivers/me | UserGuard: JWT DRIVER | ProfileController → profile.profile |
| PATCH | /drivers/me | UserGuard | ProfileController → profile.updateProfile |
| GET | /drivers/me/vehicles | UserGuard | VehicleController → vehicle.vehicles |
| POST | /drivers/me/vehicles | UserGuard | VehicleController → vehicle.createVehicle |
| GET | /drivers/me/vehicles/:id | UserGuard, UUID, owner | VehicleController → vehicle.vehicle |
| PATCH | /drivers/me/vehicles/:id | UserGuard, UUID, owner | VehicleController → vehicle.updateVehicle |
| PUT | /drivers/me/selected-vehicle | UserGuard | AvailabilityController → availability.select |
| GET | /drivers/me/availability | UserGuard | AvailabilityController → availability.availability |
| PUT | /drivers/me/availability | UserGuard | AvailabilityController → availability.setAvailability |
| GET | /internal/drivers/:driverId/eligibility | ServiceGuard: Matching X-Service-Token | InternalController → eligibility.eligibility |
| POST | /internal/drivers/eligibility/batch | RealtimeServiceGuard: riêng X-Service-Token | RealtimeInternalController → batchEligibility.execute |
| GET | /.well-known/jwks.json | Public key discovery | OperationsController → tokens.jwks |
| GET | /health/live | Probe | OperationsController |
| GET | /health/ready | Probe | OperationsController → store.ready |

Controller/guard/DTO/filter ở src/presentation/http/. Không route đăng ký, DELETE xe, admin hoặc payment. Auth endpoints trả 200; POST xe trả 201; các thao tác còn lại trả 200 khi thành công.

## Outbound và route của service khác

| Caller | Destination | Route/credential | Implementation / giới hạn |
| --- | --- | --- | --- |
| Driver EditPolicy | Trip | GET /trips/active; JWT người dùng | HttpTripActive; thêm HttpOccupancy khi cấu hình |
| Driver HttpOtp | OTP provider | POST /challenges, /challenges/consume; private Bearer | Contract local cần xác nhận, không phải API Trip |
| Realtime | Driver | POST /internal/drivers/eligibility/batch; Realtime credential | Không dùng Matching token hoặc user JWT |
| Driver occupancy | Trip | POST /internal/trips/active-drivers/batch; TRIP_LOOKUP_TOKEN | Internal active-driver lookup; fail closed |
| Driver occupancy | Matching | POST /internal/matching/reservations/batch; MATCHING_LOOKUP_TOKEN | Reservation lookup; không đọc Redis Matching |
| Realtime | Driver | GET /.well-known/jwks.json | Xác minh JWT Socket.IO |
| App Driver | Trip | GET /trips/active, /trips/history, /trips/:id | TripClient, JWT DRIVER, trust được xác nhận |
| App Driver | Trip | PATCH /trips/:id/status, POST /trips/:id/cancel | version + Idempotency-Key |
| App Driver | Realtime | Socket.IO /realtime, driver.location.update | Driver JWT; foreground GPS |

Nearby thuộc Realtime GET /internal/realtime/nearby-drivers cho Routing. Offer/accept/decline đã có REST trong Matching, không mount tại Driver; app offer UI chưa tích hợp. Trip route cũng không mount trong Driver.

## Ingress chính thức

Giữ nguyên status, envelope, X-Request-Id, Retry-After, Authorization, Idempotency-Key và replay header của upstream. Không public Matching/Realtime internal endpoints. Nếu forward IP cho rate limit, Gateway phải dùng credential riêng và X-Driver-Client-IP theo client-address.ts; direct mode lấy socket remoteAddress, bỏ qua header không được xác thực.

Gateway mode của app là tùy chọn có xác nhận path mapping, không tham chiếu thư mục Gateway demo. Không dùng service credential thay JWT DRIVER trên route Trip.
