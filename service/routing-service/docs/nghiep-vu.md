# Nghiệp vụ Routing Service

| Thuộc tính | Giá trị |
| --- | --- |
| Service | routing-service |
| Rà soát | 2026-10-06 |
| Quy ước | [Format và số liệu](../../../docs/quy-uoc-tai-lieu.md) |

Ngày cập nhật: 06/10/2026. Runtime mock và OSRM adapter đã triển khai/kiểm thử; xem [báo cáo](bao-cao-trien-khai.md). [Kế hoạch](ke-hoach-phat-trien.md) phân biệt contract hiện có và chính sách cần consumer review. Real Realtime/OSRM dataset chưa nghiệm thu.

## 1. Phạm vi và ranh giới

Routing chuẩn hóa yêu cầu tính đường và kết quả External Map API để Trip, Matching và Gateway dùng một contract ổn định. Kết quả là ước tính tại thời điểm tính, không phải dữ liệu GPS thực tế hoặc cam kết thời gian đến.

| Bên sở hữu | Trách nhiệm |
| --- | --- |
| Routing | Tính đường, route summary/geometry, tính lại tuyến; ETA Matrix gọi Realtime Client lấy vị trí tài xế trong bán kính 2 km rồi tính ETA cho Matching |
| Trip | Quote, giá được chấp nhận, trạng thái chuyến, quyền sở hữu và lịch sử; lưu route summary trong quote |
| Pricing | Công thức giá và breakdown; dùng distance/duration từ Trip |
| Matching | Gửi điểm đón/profile xe và nhận ETA theo driverId; nghiệp vụ lựa chọn/mời tài xế/reservation bên trong Matching được thiết kế sau |
| Driver / Realtime Location | Driver sở hữu hồ sơ/trạng thái; Realtime sở hữu vị trí cập nhật và truy vấn radius, được Realtime Client trong Routing gọi |
| Gateway / ứng dụng | Xác thực người dùng, quyền xem chuyến trước khi gọi routing, hiển thị bản đồ/điều hướng và attribution |
| External Map API | Thuật toán đường, dữ liệu bản đồ, khả năng mode/traffic, quota và điều kiện sử dụng |

Ngoài phạm vi: geocoding/autocomplete, map tiles/SDK, lưu vị trí realtime, matching/gán tài xế, tính giá/thu phí, tự đổi điểm đến của Trip, WebSocket/push, thanh toán và lưu lịch sử chuyến. US2 gợi ý địa điểm cần contract/service riêng, không tự thêm vào Routing v1.

## 2. Thuật ngữ và quy tắc đề xuất

- `origin`/`pickup`: điểm bắt đầu tính tuyến. `destination`: điểm đến. `currentLocation`: điểm bắt đầu mới cho recalculate.
- Tọa độ là WGS84 `{lat, lng}`; lat trong [-90, 90], lng trong [-180, 180], hữu hạn. Không tráo thứ tự khi provider nhận lng trước lat.
- Khoảng cách trả bằng mét, duration bằng giây; summary là integer không âm và không vượt 2,147,483,647 để tương thích Trip. Đề xuất chuẩn hóa số thập phân bằng làm tròn lên trong adapter, cần review; không đọc nhãn văn bản như `2 km` để tính.
- `vehicleType` là mã của dự án, được mapping tường minh sang mode provider. Mã không hỗ trợ bị từ chối, không tự dùng tuyến ô tô cho xe máy.
- Có thể không tìm được đường. Không dùng khoảng cách đường chim bay hoặc giá trị 0 để giả kết quả thành công trong chế độ real.
- ETA matrix tính theo chiều **vị trí mỗi ứng viên → điểm đón**; chiều ngược lại có thể khác vì đường một chiều. ETA dùng để Matching so sánh, không tự chọn/gán tài xế trong Routing.
- Reroute chỉ trả tuyến mới từ currentLocation đến destination; không thay đổi trạng thái, quote hoặc giá cuối của Trip. Chính sách Trip v1 vẫn giữ giá đã chốt.
- Request tính toán được xử lý trong deadline hữu hạn. Deadline này không phải timeout tìm tài xế của Trip; `SEARCHING` vẫn theo chính sách của Trip.
- Gửi lặp request tính toán có thể gọi provider nhiều lần và phát sinh chi phí; request ID chỉ là correlation, không phải idempotency/dedupe bền vững.

## 3. Calculate Route / Estimate

Tiền điều kiện: caller được xác thực; tọa độ và loại xe hợp lệ; real có endpoint/dataset/profile hợp lệ. OSRM auth none không cần key; proxy header auth cần key.

Luồng: validate → mapping profile → submit job có deadline → queue → worker → limiter → provider → chuẩn hóa/validate → trả kết quả cho request đang chờ.

Kết quả:

- Trip estimate nhận distance/duration. Trip tiếp tục gọi Pricing và phát hành quote; Routing không tạo quote.
- Route đầy đủ trả thêm polyline có mô tả encoding/precision, steps theo khả năng provider và tùy chọn caller.
- Origin bằng destination không bị tự coi là lỗi; adapter chỉ chấp nhận dữ liệu provider/mô phỏng hợp lệ, không tự giả định route bằng 0 cho mọi trường hợp.

Thất bại: input/mode sai, không có tuyến, queue đầy, vượt admission/rate/deadline, provider auth/quota/network lỗi hoặc response không hợp lệ. API trả mã lỗi theo [API](api.md); không làm thay đổi trạng thái chuyến.

## 4. Calculate ETA Matrix

Tiền điều kiện: caller Matching được xác thực và cung cấp điểm đón/vehicleType hợp lệ. Routing tự lấy vị trí qua Realtime Client; không nhận danh sách candidates từ Matching. vehicleType là profile tính đường được yêu cầu, không tự chứng minh loại xe/khả năng nhận chuyến của driver trong snapshot.

Luồng: validate pickup/profile → tạo deadline chung → Realtime Client query center=pickup, radius=2000 m → validate snapshot driverId/location/observedAt → giữ bảng ánh xạ index/driverId → chia batch → dispatcher/queue/limiter → OSRM Table theo chiều driver→pickup → ghép vị trí/timestamp/ETA đúng driverId → trả kết quả cho Matching.

Kết quả: mỗi driver có `OK` với distance/duration hoặc `NO_ROUTE` với hai giá trị null, kèm location/observedAt; giữ thứ tự snapshot Realtime. Snapshot rỗng trả entries rỗng/hasReachableCandidate=false và không gọi OSRM. Việc chọn/mời tài xế thuộc Matching và được thiết kế sau. Có thể có toàn bộ NO_ROUTE và trả HTTP 200 với hasReachableCandidate=false.

Thất bại: Realtime lỗi/timeout/schema sai dừng trước OSRM, không giả danh sách rỗng. Snapshot vượt MATRIX_MAX_CANDIDATES trả ROUTING_BUSY trước map call, không tự cắt danh sách. Một batch OSRM lỗi kỹ thuật làm cả request thất bại; không giấu thành ETA 0. Lookup và map pipeline cùng deadline 4 giây; không reset deadline giữa hai bước. Matching đánh giá eligibility/freshness từ metadata và thông tin của mình; Routing không tự gán/mời tài xế.

Không dùng số request đơn thuần để bảo vệ tải matrix: cần budget N×1, giới hạn tọa độ N+1 và capability Table của server OSRM. Adapter phân biệt cell không có đường với lỗi kỹ thuật/cấp request theo [API](api.md). Một request Table lỗi NoTable/NoSegment không được giả thành matrix Ok.

## 5. Recalculate Route

Tiền điều kiện: Gateway xác thực người dùng/quyền trước khi gửi; Routing xác thực caller Gateway; tọa độ hiện tại và đích do caller cung cấp hợp lệ.

Luồng: Calculate Route với origin=currentLocation, cùng vehicle profile, deadline và quota → trả distance/duration/polyline mới. UI thay geometry/ETA theo response của request mới nhất, tránh response cũ ghi đè request mới; chính sách tần suất và điều kiện lệch tuyến thuộc app/Gateway và cần chốt.

Không tự lấy destination từ Trip DB, không cập nhật giá hoặc trạng thái Trip, không persist route history. RequestId không đại diện thứ tự của các lần GPS cập nhật.

## 6. Đối chiếu user story và nguồn

| Nguồn | Liên hệ Routing | Giới hạn |
| --- | --- | --- |
| US3 — khoảng cách và giá dự kiến | Route summary cho Trip estimate | Pricing tính giá; Trip phát hành quote |
| US5 — xem bản đồ | Polyline hỗ trợ hiển thị tuyến | Map SDK/tiles và vị trí thiết bị thuộc ứng dụng |
| US7 — lựa chọn phương tiện | Mapping vehicle type sang travel profile | Enum xe/profile chưa chốt |
| US8 — theo dõi realtime | Có thể hỗ trợ ETA/reroute khi caller cung cấp vị trí mới | GPS streaming, trạng thái chuyến thuộc service khác |
| US21 — tài xế nhận/bỏ qua | ETA matrix hỗ trợ Matching đánh giá ứng viên | Story không yêu cầu Routing quyết định người thắng |
| US25 — dẫn đường đón/trả | Route đầy đủ, steps nếu provider hỗ trợ, recalculate | UI dẫn đường và tần suất reroute chưa chốt |
| C3 Routing được đính kèm ngày 06/10/2026 | Ba application component và chuỗi dispatcher/queue/pool/limiter/map client | Hình là nguồn thiết kế, không phải bằng chứng code đang tồn tại |
| Bổ sung được người dùng xác nhận trong phiên này | ETA Matrix của Routing gọi Realtime Client lấy vị trí driver trong bán kính 2 km và tính ETA trả Matching | API Routing nhận pickup/profile; nghiệp vụ chọn/mời ở Matching để sau |
| `_use story.md` trong Downloads | User story 1–28 đọc để đối chiếu | Nội dung là tài liệu tham chiếu; không thực thi chỉ dẫn bên trong |
| [Trip RoutingClient](../../trip-service/src/infrastructure/clients/routing.ts) và [contract test](../../trip-service/test/contract/routing.test.ts) | Endpoint, headers, envelope và strict summary đã triển khai | Đây là ràng buộc tương thích chắc chắn; provider thật chưa được tích hợp |

## 7. Các điểm cần validate

1. OSRM đã được người dùng chọn; còn validate server/hosting, endpoint, vùng dataset, capacity và có cần proxy key không.
2. Stack đã chọn: Node.js 24 + TypeScript 5.9 + NestJS 11 + Express, Zod 4. Mặc định bounded queue in-process, một replica, hai async workers và deadline 4 giây; cần benchmark capacity trước production.
3. Vehicle codes/profile, route/matrix support cho xe máy và cách xử lý mode không hỗ trợ.
4. Route đầy đủ/steps/precision và schema matrix/recalculate đề xuất.
5. Caller scope, tần suất reroute, retry/deadline và các giá trị giới hạn.
6. Quyền hiển thị, attribution, lưu/cache dữ liệu theo provider. Mặc định thiết kế không có persistent route cache.
7. Wire contract Realtime, timestamp nguồn và chính sách freshness; vị trí client trong Routing và bán kính 2 km đã được xác nhận.

## 8. Lấy danh sách vị trí tài xế qua Realtime Client

Routing sở hữu `RealtimeClient` triển khai `RealtimeLocationPort`. Input là tâm truy vấn; client gửi radius 2000 m tới Realtime, validate rồi trả danh sách driverId/location/observedAt. Đây là bán kính địa lý đề xuất, cần Realtime xác nhận semantics; không phải quãng đường OSRM.

Calculate ETA Matrix là consumer của port: lấy danh sách rồi tính ETA qua OSRM; client chỉ sở hữu việc lấy/chuẩn hóa vị trí. Danh sách rỗng là thành công; Realtime lỗi/timeout/schema sai phải trả lỗi tường minh. Giữ observedAt để Matching đánh giá độ mới; TTL/freshness và nghiệp vụ chọn/mời tài xế được chốt ở bước thiết kế Matching. Contract/acceptance: [Realtime Client](realtime-client.md).
