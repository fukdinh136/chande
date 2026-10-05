# Nghiệp vụ Realtime Service — giai đoạn 1

Ngày đối chiếu: 06/10/2026. V1 đã có mã cho GPS và nearby; chưa nghiệm thu runtime. [Kiến trúc](kien-truc.md), [API](api.md), [Routes](routes.md), [Deploy](deploy.md).

## 1. Nguồn và mức độ xác nhận

- Phạm vi V1 gồm GPS Driver và nearby cho Routing. Route, ngưỡng và lỗi lấy từ implementation hiện tại.
- Cách tổ chức tài liệu theo [Driver](../../driver-service/README.md) và bộ docs của Driver. [Nghiệp vụ Trip](../../trip-service/docs/nghiep-vu.md) mục 10 là nguồn ánh xạ user story; chưa có nguồn user story độc lập mới hơn để xác nhận toàn bộ hệ thống.
- “Đã triển khai” nghĩa là có mã với hành vi tương ứng. Không đồng nghĩa đã chạy được với Redis, issuer, Routing/Driver thật hoặc app trên thiết bị. Các tiêu chí nghiệm thu ở cuối là việc cần kiểm thử, chưa đánh dấu pass.

## 2. Phạm vi

### Trong Realtime v1

Nhận GPS của chủ thể DRIVER đã xác thực; trả ACK; lưu vị trí mới nhất, thời gian đo/nhận và watermark thứ tự; dọn vị trí cũ; trả danh sách gần cho Routing qua HTTP nội bộ, kiểm tra độ mới và eligibility Driver theo lô.

### Ngoài Realtime v1

OTP/refresh/logout, đăng ký tài xế, hồ sơ/xe, ghi ONLINE/OFFLINE, assignment và vòng đời Trip, Matching/offer/accept/decline/reservation, bản đồ/route/ETA, chat/push, GPS history và tracking theo tripId. Không có room chuyến, event receiver Trip hoặc API public để Rider xem các tài xế quanh mình.

## 3. Ranh giới và nguồn dữ liệu chuẩn

| Thành phần | Sở hữu | Realtime phối hợp |
| --- | --- | --- |
| Driver App | Quyền vị trí, đo GPS, foreground/focus, phiên người dùng | Gửi GPS với Driver JWT; hiển thị ACK/lỗi |
| Realtime | Vị trí mới nhất, thời gian đo/nhận, GEO, expiry, watermark | Lưu Redis riêng; nhận GPS và trả nearby |
| Driver | Identity, ý định PostgreSQL ONLINE/OFFLINE, xe chọn/active, policy eligibility | Cấp JWT/JWKS; trả batch eligibility qua credential riêng |
| Routing | Điểm đón và nhu cầu loại xe, xử lý danh sách vị trí | Là caller của nearby; chưa có consumer thật được kiểm chứng |
| Matching | Mời/accept/decline và reservation | Kiểm tra lại trước chọn/gán; nearby không thực hiện trách nhiệm này |
| Trip | Active Trip, assignment, version và lịch sử trạng thái | Realtime không gọi Trip hoặc đọc trip_db |
| Gateway chính thức | Exposure/TLS/proxy khi nhóm triển khai | Contract chuyển tiếp Socket.IO còn chờ; Gateway demo không phải dependency |

Chỉ Realtime ghi realtime:{gps}:*. Driver giữ ownership các key riêng của mình; Realtime chỉ nhận câu trả lời qua HTTP. Danh sách gần là snapshot có thể thay đổi ngay sau khi đọc, không phải cam kết giữ tài xế rảnh.

## 4. Quy tắc đang có trong mã

| Mã | Quy tắc | Giới hạn thực tế |
| --- | --- | --- |
| RBR-01 | driverId lấy từ JWT sub đã xác minh; role DRIVER | Không nhận driverId/type/status trong GPS |
| RBR-02 | Kiểm signature RS256, issuer, audience, exp, iat và sub UUID | Không kiểm thu hồi access token trực tuyến; logout app phải đóng socket |
| RBR-03 | App gửi khi người dùng bật GPS, có phiên/xe chọn/ONLINE, focus và foreground | Backend nhận GPS không gọi eligibility; ACK không khẳng định đủ điều kiện nhận cuốc |
| RBR-04 | Chu kỳ mục tiêu 10.000 ms, không chồng lượt đo/gửi | OS/mạng có thể làm chậm; backend không tự lấy GPS từ điện thoại |
| RBR-05 | Tuổi đo và tuổi nhận phải nhỏ hơn freshness | Default/tối đa 30.000 ms; đạt đúng ngưỡng đã stale |
| RBR-06 | Future tối đa mặc định 5.000 ms; accuracy mặc định 0–100 m | Có cấu hình; timestamp client không đáng tin như đồng hồ chuẩn |
| RBR-07 | Recorded time cũ hơn watermark không ghi đè | Thứ tự theo timestamp thiết bị; lệch đồng hồ có thể khiến bản tin hợp lệ về vật lý bị từ chối |
| RBR-08 | Cùng time và cùng tọa độ/accuracy khi metadata còn tồn tại trả DUPLICATE | Không kéo dài receivedAt hoặc expiry; bản tin stale vẫn bị từ chối trước duplicate |
| RBR-09 | Cùng time khác payload trả LOCATION_OUT_OF_ORDER | Không chọn payload đến sau như dữ liệu mới |
| RBR-10 | Bản tin mới cách lượt nhận trước dưới 1.000 ms bị RATE_LIMITED | Đây là min interval server, khác chu kỳ 10 giây của app |
| RBR-11 | Radius mặc định/tối đa 2.000 m; trả tối đa 50 | Radius tùy chọn 1–2.000 m; result limit 50 là hằng số |
| RBR-12 | Loại xe từ Driver: BIKE/CAR_4/CAR_7 | Không suy ra loại xe từ GPS; bộ mã cần thống nhất với Routing/Driver |
| RBR-13 | Chỉ trả quyết định eligible=true và availabilityKnown=true | UNKNOWN còn trong phạm vi tìm kiếm gây 503; không trả danh sách thiếu rồi gọi là đầy đủ |
| RBR-14 | Disconnect/expiry GPS không đổi ý định hoặc hủy Trip | Vị trí có thể còn được xét đến khi hết freshness |
| RBR-15 | Redis/Driver/contract lỗi trả lỗi phụ thuộc | Không biến outage thành drivers:[] hoặc tự đánh dấu AVAILABLE |

## 5. UC-R01 — gửi vị trí và reconnect

1. Tài xế dùng luồng OTP tại Driver cho tài khoản đã có; app restore/refresh qua SessionManager hiện tại. Realtime không cấp hay refresh token.
2. Qua API Driver, tài xế chuẩn bị hồ sơ/xe, chọn xe và bật ý định ONLINE. Đây không phải chuyển trạng thái vận hành sang AVAILABLE.
3. Ở OverviewScreen, tài xế bật GPS. GpsCard kiểm phiên/ONLINE/selection; useDriverGps yêu cầu quyền foreground, chỉ chạy khi focus và AppState active.
4. SocketLocationClient kết nối namespace /realtime bằng auth.token. Server xác minh JWT qua JWKS Driver, gắn identity vào socket; mỗi event kiểm expiry, timer đóng idle socket khi hết hạn.
5. App đo vị trí thật bằng getCurrentPositionAsync, gửi tọa độ/accuracy/timestamp đo, mục tiêu 10 giây/lần. Không gửi khi accuracy chưa xác định; không giữ backlog vị trí cũ để replay.
6. Gateway validate DTO → UpdateLocation → LocationPolicy → LocationStore. Lua kiểm lại tuổi/thứ tự bằng Redis TIME rồi cập nhật GEO/metadata/expiry/watermark trong cùng lần thực thi.
7. STORED nghĩa Redis đã phản hồi ghi; DUPLICATE nghĩa cùng mẫu đã có. ACK không chứng minh được Matching chọn, Driver AVAILABLE hoặc Redis đã lưu bền trên đĩa.
8. Lỗi ACK hoặc timeout được hiển thị; chu kỳ sau đo mẫu mới. Timeout không chứng minh Redis chưa xử lý. App không lặp tự động mẫu GPS cũ.
9. Mất mạng: client reconnect; callback auth gọi API profile được bảo vệ để dùng refresh single-flight hiện có, kiểm cùng driver, lấy JWT hiện tại, sau kết nối đo GPS mới. CLI thủ công không tự refresh/reconnect.
10. Tắt GPS, logout, mất điều kiện, rời focus/background: cleanup timer/socket; hủy request profile qua AbortController; bỏ listener khi unmount. Promise đo native đang chạy không nhất thiết bị OS hủy, nhưng kết quả sau disposal không được gửi.

Availability được đọc lại ở OverviewScreen theo mục tiêu 10 giây. Khi server chuyển OFFLINE/selection mất hiệu lực hoặc lần đọc lỗi, điều kiện GPS bị tắt sau khi UI quan sát. Không cam kết dừng tức thì xuyên service. Nếu quyền bị từ chối/thu hồi hoặc location services tắt, app dừng vòng gửi; người dùng bật quyền lại và tắt/bật GPS.

Foreground GPS có mã; chưa chạy trên emulator/thiết bị. Không có background task hay giao thức presence heartbeat riêng. Socket disconnect không xóa ngay GPS, không giải phóng reservation và không kết thúc Trip.

## 6. UC-R02 — Routing tìm tài xế gần

1. Routing gửi latitude/longitude của điểm đón, vehicleType tùy chọn, radiusMeters tùy chọn, với X-Service-Token riêng.
2. Guard xác thực credential; DTO và NearbyPolicy kiểm query. Rider/Driver JWT không thay thế credential nội bộ.
3. LocationStore GEOSEARCH trong bán kính, ASC WITHDIST; kiểm expiry ngay trong Lua. Không COUNT 50 trước lọc. Nếu tổng GEO rows trong bán kính vượt NEARBY_MAX_CANDIDATES, trả SEARCH_CAPACITY_EXCEEDED trước lọc metadata.
4. FindNearby kiểm lại tuổi đo/nhận bằng đồng hồ process. Không có ứng viên mới thì trả 200 drivers:[] và không cần gọi Driver.
5. DriverEligibilityClient chia tối đa 100 UUID/request; gọi các lô tuần tự với một deadline chung DRIVER_TIMEOUT_MS, validate envelope/định danh/cờ trả về.
6. Driver đọc nguồn của mình: ý định ONLINE, hồ sơ, selection đúng owner, xe active/type và projection vận hành. Legacy không tự chuyển đổi. Chỉ eligible khi profile hợp lệ, projection ONLINE và operational AVAILABLE; BUSY/OFFLINE bị loại.
7. Sau HTTP, Realtime đọc lại GEO/metadata: loại mẫu hết hạn/ra ngoài bán kính; dùng vị trí mới nhất. Tài xế mới xuất hiện chưa được kiểm eligibility không nằm trong response lần này.
8. Nếu một ứng viên còn mới trong lần đọc lại có availabilityKnown=false, trả 503 ELIGIBILITY_UNDETERMINED. Nếu tất cả quyết định đủ thông tin, lọc eligible/type rồi sort distanceMeters, tie-break driverId và lấy tối đa 50.
9. Trả danh sách nội bộ tối thiểu; distance là khoảng cách địa lý do GEO, không quãng đường chạy xe/ETA. Routing phải xử lý [] khác lỗi 503.

## 7. Eligibility, tính nhất quán và giới hạn

Batch hiện đã có trong Driver, khác endpoint Matching từng tài xế chỉ trả profileEligible. availabilityKnown=true có thể đi cùng profileEligible=false: đã có lý do chắc chắn để loại tài xế, không có nghĩa đã đối soát active Trip.

ONLINE + xe/hồ sơ hợp lệ nhưng projection absent/lệch/UNKNOWN trả availabilityKnown=false. Realtime không tự quảng bá AVAILABLE từ GPS. Driver batch không có quyền gọi GET /trips/active thay một tài xế bằng service credential; Trip không cung cấp lookup nội bộ theo driverId trong contract hiện tại.

**Còn chờ phối hợp:** nguồn có thẩm quyền cập nhật AVAILABLE/BUSY, freshness của projection và đối soát với active Trip. AVAILABLE từ cache hiện tại vẫn có thể cũ. Nearby không kiểm reservation và không tạo lease; Matching/Trip phải kiểm lại khi reservation/assignment. Không suy ra kết thúc chuyến từ TTL lock. PostgreSQL, Redis và HTTP không có transaction chung.

Watermark mặc định giữ 24 giờ sau lượt ghi, dọn riêng khỏi metadata 30 giây. Redis mất dữ liệu thì watermark cũng có thể mất; không có lịch sử GPS bền để khôi phục thứ tự trước đó. ACK không bảo đảm exactly-once qua restart/failover. Đồng hồ thiết bị/process/Redis cần đồng bộ; app lấy thời gian đo của OS, không thay bằng thời gian retry.

## 8. Lỗi, dữ liệu trống và quyền xem

| Tình huống | Hành vi trong mã |
| --- | --- |
| DTO sai/unknown field/accuracy quá giới hạn | ACK INVALID_REQUEST hoặc HTTP 400 cho query |
| JWT sai/hết hạn/JWKS timeout | connect_error; event hết phiên trả UNAUTHENTICATED; JWKS timeout được phân loại dependency |
| Redis không khả dụng | ACK/nearby DEPENDENCY_UNAVAILABLE; ready 503 |
| Driver timeout/status lỗi/JSON thiếu hoặc sai | Nearby 503 DEPENDENCY_UNAVAILABLE, không [] |
| Eligibility chưa xác định của ứng viên còn mới | Nearby 503 ELIGIBILITY_UNDETERMINED |
| Không GPS mới trong bán kính hoặc tất cả bị loại có căn cứ | 200 drivers:[] |
| Cleanup bị dừng/chậm | Dữ liệu vật lý có thể còn; read vẫn lọc expiry/freshness |
| Routing thiếu/sai credential | HTTP 401 INVALID_SERVICE_CREDENTIAL |

Driver chỉ gửi vị trí của mình; không có API đọc vị trí theo driverId hoặc subscribe phòng tài xế khác. Routing có credential được xem danh sách nội bộ cho điểm đón, không có scope theo từng rider/trip trong v1. Không expose /internal/* cho Rider hoặc nhúng service credential trong EXPO_PUBLIC_*. Transport TLS/private network/ACL cần triển khai khi vận hành; CORS không thay thế authentication. Code không log JWT/payload GPS.

## 9. Liên hệ user story

| Story | Vai trò Realtime v1 | Phần vẫn thuộc bên khác |
| --- | --- | --- |
| US5 / US-05 — bản đồ/vị trí/điểm đón trả | GPS và nearby hỗ trợ dữ liệu vị trí | UI bản đồ, điểm đón/trả, route thuộc app/Routing/Trip |
| US7 / US-07 — chọn loại phương tiện | Filter BIKE/CAR_4/CAR_7 từ Driver | Danh mục chung, UI chọn xe, quote thuộc Driver/Routing/Trip |
| US19 / US-19 — đăng nhập tài xế | Tin cậy JWT/JWKS Driver | OTP/session/refresh/logout thuộc Driver và app |
| US20 / US-20 — đăng ký phương tiện | Dùng xe được Driver xác minh | Tạo xe/ownership/unique plate thuộc Driver |
| US23 / US-23 — bật/tắt nhận cuốc | Eligibility lọc ý định và vận hành; app dừng GPS khi mất điều kiện | PostgreSQL intent thuộc Driver; offer/reservation thuộc Matching |
| US28 / US-28 — cập nhật phương tiện | Không tin type từ GPS; loại xe inactive qua Driver | Sửa xe và clear selection thuộc Driver |
| US8 / US-08 — theo dõi chuyến realtime | Chỉ nền tảng thu nhận vị trí | Chưa có trip room, phân quyền rider theo assignment, stream vị trí chuyến hay event Trip |

## 10. Tiêu chí nghiệm thu cần tự kiểm thử

| Mã | Tình huống | Mong đợi / điều kiện |
| --- | --- | --- |
| RAC-01 | JWT đúng/sai issuer/audience/role/expiry | Chỉ identity DRIVER hợp lệ gửi được GPS |
| RAC-02 | Gửi thêm driverId/type/status hoặc numeric string | ACK INVALID_REQUEST, không ghi |
| RAC-03 | GPS mới, cũ hơn, cùng time giống/khác payload | STORED; OUT_OF_ORDER; DUPLICATE hoặc OUT_OF_ORDER tương ứng |
| RAC-04 | Tuổi đạt 30 giây/future quá ngưỡng | Bị loại, không kéo dài freshness qua retry |
| RAC-05 | Cập nhật đồng thời với cleanup trên Redis thật | Vị trí vừa ghi hợp lệ không bị cleanup xóa nhầm |
| RAC-06 | Nhiều tài xế eligible trong 2 km, có xe sai loại | Danh sách nhiều xe, đúng type, gần → xa, tối đa 50; cần projection đã được xác nhận |
| RAC-07 | Không xe phù hợp | 200 drivers:[], không tạo assignment |
| RAC-08 | UNKNOWN/Redis lỗi/Driver lỗi | 503 đúng code, không ứng viên giả |
| RAC-09 | Tắt GPS/background/rời màn hình/logout/thu hồi quyền | Không tiếp tục gửi từ vòng cũ; cleanup listener/timer/socket |
| RAC-10 | Reconnect/token expiry/refresh đồng thời | Lấy JWT qua single-flight; đo mới, không replay backlog |

Các RAC là tiêu chí kiểm thử thủ công, chưa có bằng chứng nghiệm thu runtime. Xem thao tác ở [Deploy](deploy.md).
