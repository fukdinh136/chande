# Routes Realtime Service

| Thuộc tính | Giá trị |
| --- | --- |
| Service | realtime-service |
| Rà soát | 2026-10-06 |
| Quy ước | [Format và số liệu](../../../docs/quy-uoc-tai-lieu.md) |

Ngày đối chiếu: 06/10/2026. GPS/offer đã kiểm chứng Docker local Hà Nội; thiết bị và ingress production chưa nghiệm thu. [API](api.md), [Kiến trúc](kien-truc.md), [Nghiệp vụ](nghiep-vu.md), [Deploy](deploy.md).

## 1. Exposure và prefix

Realtime mặc định port 3004, cùng process cho HTTP và Socket.IO, không global /api/v1 prefix. Namespace /realtime khác Engine.IO path /socket.io/ mặc định; namespace không phải một GET REST route.

main.ts listen 0.0.0.0; chưa có ingress/firewall/TLS được tạo trong service. Internal route có guard nhưng vẫn cần mạng private. Health không có auth guard, cần hạn chế exposure ở tầng vận hành. Socket dùng JWT, allowlist Origin và websocket-only; CORS/Origin không thay authentication.

Gateway chính thức có thể proxy sau này nhưng chưa có proxy trong Realtime. Không yêu cầu Gateway demo. Không expose driver-locations cho Rider hoặc chuyển service credential vào app.

## 2. Driver App → Realtime qua Socket.IO

| Mã | Hướng / namespace-event | Caller | Authentication | Handler / use case | Exposure |
| --- | --- | --- | --- | --- | --- |
| S00 | Connect namespace /realtime | Driver App; CLI Socket.IO khi test | handshake auth.token; JWT/JWKS, role DRIVER, issuer/audience/expiry; Origin nếu có | LocationGateway.afterInit → TokenVerifier.verify | Kênh client DRIVER; chưa có public ingress |
| S01 | Client → server: driver.location.update | Driver App/CLI đã kết nối | DriverSocketGuard.actor kiểm identity/expiry | LocationGateway.location → UpdateLocation.execute | Chỉ GPS của chủ thể từ token |
| S02 | Server → callback ACK của S01 | Realtime trả cho socket gọi | Kế thừa identity S01 | envelope/errorResponse | Không broadcast hoặc room |
| S03 | Server → client: connect_error/disconnect | Handshake lỗi/token expiry; network cũng có thể disconnect | Lifecycle Socket.IO | Auth middleware, expiry timer, handleDisconnect | Không đổi Driver/Trip |

Payload/ACK xem API mục 3. Transport chỉ websocket, không polling fallback. Không có event ONLINE/OFFLINE, heartbeat presence, offer, trip tracking hoặc subscribe vị trí tài xế khác. Scheduler 10 giây nằm phía app.

## 3. Matching → Realtime qua HTTP nội bộ

| Mã | Method / route | Caller | Authentication | Handler / use case | Exposure / kết quả |
| --- | --- | --- | --- | --- | --- |
| R02 | GET /internal/realtime/driver-locations | Matching | X-Service-Token = MATCHING_LOCATION_TOKEN, MatchingServiceGuard | DriverLocationsController.locations → ListDriverLocations.execute | Nội bộ; vị trí thô gần nhất trước, `limit` mặc định 50, tối đa 200 ([ADR-0001](../../../docs/adr/0001-matching-so-huu-tim-ung-vien.md)) |

R01 `GET /internal/realtime/nearby-drivers` cho Routing đã gỡ ngày 2026-11-05. Kết quả không lọc loại xe hay trạng thái tài xế; Matching kiểm điều kiện ở Driver.

## 4. Probes tại Realtime

| Mã | Method / route | Caller | Authentication | Handler | Exposure / kết quả |
| --- | --- | --- | --- | --- | --- |
| H01 | GET /health/live | Operator/probe | Không guard trong code | HealthController.live | Nên ở mạng vận hành; 200 {status:ok} |
| H02 | GET /health/ready | Operator/probe | Không guard trong code | HealthController.ready → LocationStore.ready | Redis PING; 200 ready / 503 not_ready |

Health không business envelope; ready không kiểm Driver/JWKS/Trip hay quyền EVAL/GEO. Chưa có /metrics, /docs hoặc /openapi.json. Invalid HTTP route nhận 404 qua ErrorFilter, không phải API mới.

## 5. Realtime → Driver Service

Realtime không gọi API nghiệp vụ của Driver; chỉ đọc JWKS để xác thực JWT tài xế (mục 6). Lời gọi `POST /internal/drivers/eligibility/batch` (O01) đã gỡ ngày 2026-11-05.

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
| D02 | ListDriverLocations | EVAL FIND_NEAREST; TIME/GEOSEARCH COUNT/ZSCORE/HGET | Cùng credential, không đọc Driver keys | RedisLocationRepository.nearest |
| D03 | CleanupScheduler → CleanupStale | EVAL CLEANUP_STALE; TIME/ZRANGEBYSCORE/ZREM/HDEL | Cùng ownership | RedisLocationRepository.cleanup |
| D04 | HealthController | PING | Cùng Redis connection | RedisLocationRepository.ready |

Năm key realtime:{gps}:geo/meta/expiry/order/order-expiry ở [Kiến trúc](kien-truc.md). Không expose Redis qua HTTP, không dùng lock Matching hoặc drivers:geo:* cho GPS mới.

## 8. Offer events và Matching lookups

| Hướng | Route/event | Auth / vai trò |
| --- | --- | --- |
| Rabbit → Realtime | DRIVER_TRIP_OFFER / DRIVER_TRIP_OFFER_UPDATED | Durable queue driver.offers; manual ACK, retry/DLQ |
| Realtime → Matching | GET /internal/matching/offers/:offerId | MATCHING_REALTIME_TOKEN; state authoritative |
| Realtime → Matching | GET /internal/matching/drivers/:driverId/offer | Cùng credential; reconnect chính driver đã xác thực |
| Realtime → Driver App | driver.trip.offer / driver.trip.offer.updated | Room driver từ JWT; `{data:<offer>}` |

Accept/decline thuộc REST Matching, không thêm socket command trong Realtime. Registry/rotation credential, ingress Gateway, trip room US8 và legacy GEO migration chưa nghiệm thu; producer occupancy Driver đã triển khai.
