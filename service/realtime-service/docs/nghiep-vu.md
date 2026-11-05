# Nghiệp vụ Realtime Service — giai đoạn 1

| Thuộc tính | Giá trị |
| --- | --- |
| Service | realtime-service |
| Rà soát | 2026-10-06 |
| Quy ước | [Format và số liệu](../../../docs/quy-uoc-tai-lieu.md) |

Ngày đối chiếu: 06/10/2026. GPS/offer đã chạy qua Docker local Hà Nội; thiết bị/background và production chưa nghiệm thu. [Kiến trúc](kien-truc.md), [API](api.md), [Routes](routes.md), [Deploy](deploy.md).

## 1. Nguồn và mức độ xác nhận

- Phạm vi V1 gồm GPS Driver, vị trí thô cho Matching và giao offer Matching qua RabbitMQ/Socket.IO. Route, ngưỡng và lỗi lấy từ implementation hiện tại.
- Cách tổ chức tài liệu theo [Driver](../../driver-service/README.md) và bộ docs của Driver. [Nghiệp vụ Trip](../../trip-service/docs/nghiep-vu.md) mục 10 là nguồn ánh xạ user story; chưa có nguồn user story độc lập mới hơn để xác nhận toàn bộ hệ thống.
- “Đã triển khai” nghĩa là có mã với hành vi tương ứng. Không đồng nghĩa đã chạy được với Redis, issuer, Matching/Driver thật hoặc app trên thiết bị. Các tiêu chí nghiệm thu ở cuối là việc cần kiểm thử, chưa đánh dấu pass.

## 2. Phạm vi

### Trong Realtime v1

Nhận GPS của chủ thể DRIVER đã xác thực; trả ACK; lưu vị trí/thời gian và watermark; dọn vị trí cũ; trả vị trí thô còn mới cho Matching (gần nhất trước, tối đa 200). Giao offer/cập nhật vào room driver đã xác thực; reconnect lấy trạng thái Matching, không kéo dài hạn offer.

### Ngoài Realtime v1

OTP/refresh/logout, hồ sơ/xe/ONLINE, assignment/vòng đời Trip, thuật toán Matching và quyết định accept/decline/reservation, route/ETA, chat/push, GPS history/tracking theo tripId. Realtime giao offer nhưng không sở hữu quyết định offer. Không có room chuyến, Trip event receiver hoặc public nearby cho Rider.

## 3. Ranh giới và nguồn dữ liệu chuẩn

| Thành phần | Sở hữu | Realtime phối hợp |
| --- | --- | --- |
| Driver App | Quyền vị trí, đo GPS, foreground/focus, phiên người dùng | Gửi GPS với Driver JWT; hiển thị ACK/lỗi |
| Realtime | Vị trí mới nhất, thời gian đo/nhận, GEO, expiry, watermark | Lưu Redis riêng; nhận GPS và trả vị trí cho Matching |
| Driver | Identity, ý định PostgreSQL ONLINE/OFFLINE, xe chọn/active, policy eligibility | Cấp JWT/JWKS; trả batch eligibility qua credential riêng |
| Routing | Tính ETA cho vị trí Matching gửi | Không gọi Realtime từ 2026-11-05 |
| Matching | Tìm ứng viên, mời/accept/decline và reservation | Gọi driver-locations mỗi lần tìm; kiểm điều kiện ở Driver |
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
| RBR-12 | Loại xe từ Driver: BIKE/CAR_4/CAR_7 | Không suy ra loại xe từ GPS; bộ mã cần thống nhất với Matching/Driver |
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

## 6. UC-R02 — Matching lấy vị trí tài xế gần

1. Matching gửi latitude/longitude của điểm đón, radiusMeters (2000) và limit (200) với X-Service-Token = MATCHING_LOCATION_TOKEN.
2. Guard xác thực credential; DTO và use case kiểm query. Rider/Driver JWT không thay thế credential nội bộ.
3. LocationStore chạy GEOSEARCH trong bán kính, ASC, COUNT limit, WITHDIST; kiểm expiry ngay trong Lua.
4. ListDriverLocations kiểm lại tuổi đo/nhận bằng đồng hồ process và trả danh sách tối thiểu (driverId, tọa độ, distanceMeters, recordedAt).
5. Distance là khoảng cách địa lý do GEO tính, không phải quãng đường hay ETA. Không lọc loại xe hay trạng thái: Matching kiểm điều kiện ở Driver ([ADR-0001](../../../docs/adr/0001-matching-so-huu-tim-ung-vien.md)).

## 7. Eligibility, tính nhất quán và giới hạn

Realtime không quyết định tài xế có được mời hay không. Từ 2026-11-05 Matching gọi Driver theo lô cho danh sách vị trí, loại tài xế đã mời hoặc đang giữ chỗ, rồi kiểm lại khi gán; ràng buộc một chuyến mở cho mỗi tài xế ở Trip là chốt cuối. Realtime không tự quảng bá AVAILABLE từ GPS.

Watermark mặc định giữ 24 giờ sau lượt ghi, dọn riêng khỏi metadata 30 giây. Redis mất dữ liệu thì watermark cũng có thể mất; không có lịch sử GPS bền để khôi phục.

## 8. Lỗi, dữ liệu trống và quyền xem

| Tình huống | Hành vi trong mã |
| --- | --- |
| DTO sai/unknown field/accuracy quá giới hạn | ACK INVALID_REQUEST hoặc HTTP 400 cho query |
| JWT sai/hết hạn/JWKS timeout | connect_error; event hết phiên trả UNAUTHENTICATED; JWKS timeout được phân loại dependency |
| Redis không khả dụng | ACK/driver-locations DEPENDENCY_UNAVAILABLE; ready 503 |
| Không GPS mới trong bán kính hoặc tất cả bị loại có căn cứ | 200 drivers:[] |
| Cleanup bị dừng/chậm | Dữ liệu vật lý có thể còn; read vẫn lọc expiry/freshness |
| Matching thiếu/sai credential | HTTP 401 INVALID_SERVICE_CREDENTIAL |

Driver chỉ gửi vị trí của mình; không có API đọc vị trí theo driverId hoặc subscribe phòng tài xế khác. Matching có credential được xem danh sách nội bộ cho điểm đón, không có scope theo từng rider/trip trong v1. Không expose /internal/* cho Rider hoặc nhúng service credential trong EXPO_PUBLIC_*. Transport TLS/private network/ACL cần triển khai khi vận hành; CORS không thay thế authentication. Code không log JWT/payload GPS.

## 9. Liên hệ user story

| Story | Vai trò Realtime v1 | Phần vẫn thuộc bên khác |
| --- | --- | --- |
| US5 / US-05 — bản đồ/vị trí/điểm đón trả | GPS và driver-locations hỗ trợ dữ liệu vị trí | UI bản đồ, điểm đón/trả, route thuộc app/Routing/Trip |
| US7 / US-07 — chọn loại phương tiện | Loại xe do Driver trả cho Matching | Danh mục chung, UI chọn xe, quote thuộc Driver/Routing/Trip |
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

RAC là tiêu chí đối chiếu, không đánh dấu tất cả pass từ một smoke. GPS/offer/reconnect đã chạy thật trong [báo cáo Matching](../../matching-service/docs/bao-cao-trien-khai.md); thiết bị/background còn cần nghiệm thu.
