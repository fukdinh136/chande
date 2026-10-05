# Routes Realtime Service

Ngày đối chiếu: 06/10/2026. Route/event dưới đây đã có handler trong mã; chưa kiểm chứng chạy thật. [API](api.md), [Kiến trúc](kien-truc.md), [Nghiệp vụ](nghiep-vu.md), [Deploy](deploy.md).

## 1. Exposure và prefix

Realtime mặc định port 3004, cùng process cho HTTP và Socket.IO, không global /api/v1 prefix. Namespace /realtime khác Engine.IO path /socket.io/ mặc định; namespace không phải một GET REST route.

main.ts listen 0.0.0.0; chưa có ingress/firewall/TLS được tạo trong service. Internal route có guard nhưng vẫn cần mạng private. Health không có auth guard, cần hạn chế exposure ở tầng vận hành. Socket dùng JWT, allowlist Origin và websocket-only; CORS/Origin không thay authentication.

Gateway chính thức có thể proxy sau này nhưng chưa có proxy trong Realtime. Không yêu cầu Gateway demo. Không expose nearby cho Rider hoặc chuyển service credential vào app.

## 2. Driver App → Realtime qua Socket.IO

| Mã | Hướng / namespace-event | Caller | Authentication | Handler / use case | Exposure |
| --- | --- | --- | --- | --- | --- |
| S00 | Connect namespace /realtime | Driver App; CLI Socket.IO khi test | handshake auth.token; JWT/JWKS, role DRIVER, issuer/audience/expiry; Origin nếu có | LocationGateway.afterInit → TokenVerifier.verify | Kênh client DRIVER; chưa có public ingress |
| S01 | Client → server: driver.location.update | Driver App/CLI đã kết nối | DriverSocketGuard.actor kiểm identity/expiry | LocationGateway.location → UpdateLocation.execute | Chỉ GPS của chủ thể từ token |
| S02 | Server → callback ACK của S01 | Realtime trả cho socket gọi | Kế thừa identity S01 | envelope/errorResponse | Không broadcast hoặc room |
| S03 | Server → client: connect_error/disconnect | Handshake lỗi/token expiry; network cũng có thể disconnect | Lifecycle Socket.IO | Auth middleware, expiry timer, handleDisconnect | Không đổi Driver/Trip |

Payload/ACK xem API mục 3. Transport chỉ websocket, không polling fallback. Không có event ONLINE/OFFLINE, heartbeat presence, offer, trip tracking hoặc subscribe vị trí tài xế khác. Scheduler 10 giây nằm phía app.

## 3. Routing → Realtime qua HTTP nội bộ

| Mã | Method / route | Caller | Authentication | Handler / use case | Exposure / kết quả |
| --- | --- | --- | --- | --- | --- |
| R01 | GET /internal/realtime/nearby-drivers | Routing được cấp credential | X-Service-Token = ROUTING_INBOUND_TOKEN, RoutingServiceGuard | NearbyController.nearby → FindNearby.execute | Nội bộ; 200 {data:{radiusMeters,drivers},meta}; tối đa 50 |

Query latitude/longitude bắt buộc; vehicleType/radiusMeters tùy chọn. Không có actor/trip/limit/cursor query. Routing phải phân biệt 200 drivers:[] với 503 dependency/unknown. Kết quả không phải assignment. Guard chưa có registry/mTLS hoặc allowlist caller name; quyền hiện dựa trên credential riêng và deployment network.

## 4. Probes tại Realtime

| Mã | Method / route | Caller | Authentication | Handler | Exposure / kết quả |
| --- | --- | --- | --- | --- | --- |
| H01 | GET /health/live | Operator/probe | Không guard trong code | HealthController.live | Nên ở mạng vận hành; 200 {status:ok} |
| H02 | GET /health/ready | Operator/probe | Không guard trong code | HealthController.ready → LocationStore.ready | Redis PING; 200 ready / 503 not_ready |

Health không business envelope; ready không kiểm Driver/JWKS/Trip hay quyền EVAL/GEO. Chưa có /metrics, /docs hoặc /openapi.json. Invalid HTTP route nhận 404 qua ErrorFilter, không phải API mới.

## 5. Realtime → Driver Service

| Mã | Caller → đích | Method / route | Authentication | Handler/client | Trạng thái |
| --- | --- | --- | --- | --- | --- |
| O01 | FindNearby → Driver | POST DRIVER_BASE_URL + /internal/drivers/eligibility/batch | X-Service-Token = DRIVER_ELIGIBILITY_TOKEN; Driver kiểm REALTIME_INBOUND_TOKEN | DriverEligibilityClient.find → RealtimeInternalController.eligibility → BatchEligibilityUseCase.execute | Có mã hai phía; chưa nghiệm thu service thật |
| O02 | JWT verifier → Driver JWKS | GET AUTH_JWKS_URL; sample /.well-known/jwks.json | Public key endpoint, không service credential | JwksTokenVerifier → OperationsController.jwks | Có mã, fetch/cache khi cần key |

O01 gửi 1–100 UUID/lô, một deadline chung cho các lô. Không gửi JWT tài xế hoặc credential Routing tới batch. Không dùng GET /internal/drivers/:driverId/eligibility của Matching thay batch vì quyền và profileEligible khác nhau. Snapshot Driver không phải lease chống assignment race.

## 6. App → Driver: dependency của luồng GPS

Các route dưới thuộc Driver hiện có, không có bản sao trong Realtime.

| Method / route tại Driver | Caller / authentication | Vai trò |
| --- | --- | --- |
| POST /driver-auth/otp/request | App/Postman, public + hạn chế OTP | Challenge cho tài khoản đã có |
| POST /driver-auth/otp/verify | App/Postman, challenge và OTP | Cấp Driver JWT |
| POST /driver-auth/refresh | SessionManager, refresh token | Refresh single-flight phía app |
| POST /driver-auth/logout | App, refresh token | Thu hồi refresh; app cleanup socket |
| GET /drivers/me | App, JWT DRIVER | Reconnect callback dùng request protected để lấy phiên mới nếu cần |
| GET/POST /drivers/me/vehicles | App, JWT DRIVER | Danh sách/đăng ký xe thuộc mình |
| PUT /drivers/me/selected-vehicle | App, JWT DRIVER | Chọn xe theo điều kiện Driver |
| GET/PUT /drivers/me/availability | App, JWT DRIVER | Đọc/đặt intent; app kiểm lại điều kiện GPS |

Profile/vehicle update và Trip routes xem tài liệu tương ứng. GET /trips/active dùng JWT người dùng; Realtime không có outbound Trip hoặc lookup nội bộ theo driverId.

## 7. Realtime → Redis: dữ liệu, không HTTP route

| Mã | Caller | Thao tác | Authentication / ownership | Adapter |
| --- | --- | --- | --- | --- |
| D01 | UpdateLocation | EVAL UPDATE_LOCATION; TIME/GEOADD/HSET/ZADD | REDIS_URL hoặc REDIS_URL_FILE; chỉ key Realtime | RedisLocationRepository.update |
| D02 | FindNearby | EVAL FIND_NEARBY; TIME/GEOSEARCH/ZSCORE/HGET | Cùng credential, không đọc Driver keys | RedisLocationRepository.nearby |
| D03 | CleanupScheduler → CleanupStale | EVAL CLEANUP_STALE; TIME/ZRANGEBYSCORE/ZREM/HDEL | Cùng ownership | RedisLocationRepository.cleanup |
| D04 | HealthController | PING | Cùng Redis connection | RedisLocationRepository.ready |

Năm key realtime:{gps}:geo/meta/expiry/order/order-expiry ở [Kiến trúc](kien-truc.md). Không expose Redis qua HTTP, không dùng lock Matching hoặc drivers:geo:* cho GPS mới.

## 8. Chưa có route/event

Nguồn đối soát operational status/active Trip, registry credential, Gateway chuẩn, room/stream theo tripId cho US8 và chuyển consumer GEO cũ còn chờ phối hợp. Không đưa tên route dự đoán vào danh mục đã triển khai.
