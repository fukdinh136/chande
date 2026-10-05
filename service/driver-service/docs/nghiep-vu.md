# Nghiệp vụ Driver Service — giai đoạn 1

Ngày 05/10/2026. Bản thiết kế để review, chưa triển khai hoặc nghiệm thu. Liên kết: [Kiến trúc](kien-truc.md), [API](api.md), [Routes](routes.md), [Deploy](deploy.md).

## 1. Nguồn và mức độ xác nhận

- Người dùng yêu cầu giữ nguyên database Driver trong ảnh ERD và tạo tài liệu theo mẫu Trip.
- Nghiệp vụ Trip lấy từ [tài liệu nhóm](../../trip-service/docs/nghiep-vu.md); route/model lấy từ [API Trip](../../trip-service/docs/api.md). Không thay chính sách Trip.
- 28 user story lấy từ hội thoại; file `_use story.md` được Trip nhắc tới nhưng không nằm trong ZIP này.
- Các quy ước Driver trong mục 4 là đề xuất để review, chưa có DDL/code xác minh. Không suy ra một enum chỉ từ cột VARCHAR.

## 2. Phạm vi

### Trong Driver v1

US19 đăng nhập bằng SĐT/OTP với tài khoản đã tồn tại; refresh/logout; đọc/cập nhật hồ sơ; US20 đăng ký phương tiện; US28 cập nhật xe; US23 bật/tắt nhận cuốc và chọn xe; cung cấp snapshot/eligibility tối thiểu cho Matching.

### Ngoài Driver v1

Không quản lý vòng đời Trip, lời mời/accept/decline, thuật toán Matching, routing/pricing, GPS streaming, chat, khiếu nại, thống kê thu nhập, payment, hóa đơn hoặc admin duyệt tài xế. Không tự tạo tài khoản từ số điện thoại chưa tồn tại: onboarding/đăng ký tài xế cần hợp đồng riêng đủ trường bắt buộc của DDL, không thuộc US19. Chưa xóa tài xế/xe qua public API.

## 3. Ranh giới và nguồn dữ liệu chuẩn

| Thành phần | Sở hữu | Driver phối hợp |
| --- | --- | --- |
| Driver | drivers, vehicles, refresh tokens, ý định nhận cuốc | API hồ sơ/xe/status, snapshot cho Matching |
| Matching | Ứng viên, offer, accept/decline, reservation | Đọc eligibility; gửi snapshot vào callback Trip |
| Trip | Chuyến, assignment, version, history, giá/snapshot | App gọi trực tiếp qua Gateway; Driver chỉ đọc active dưới identity tài xế khi cần |
| Gateway | Proxy, WebSocket, presence/GPS và event receiver | Không ghi bảng Driver; cache/GEO là dữ liệu hỗ trợ |
| Notification | Push | Nhận event Trip theo draft của nhóm |
| App | Màn hình, lưu phiên an toàn, retry/read lại | Chưa có implementation nghiệp vụ trong ZIP |

Trip không đọc driver_db; Driver không đọc trip_db. Snapshot là thông tin tại thời điểm lấy để gán, không tự thay đổi khi hồ sơ nguồn đổi.

## 4. Quy tắc Driver đề xuất

| Mã | Quy tắc | Giới hạn |
| --- | --- | --- |
| DBR-01 | Danh tính lấy từ JWT sub, role DRIVER | Không nhận driverId tự khai trong API me |
| DBR-02 | OTP đúng, còn hạn, dưới giới hạn thử, sử dụng một lần | Mock chỉ local; lỗi mạng sau tiêu thụ có thể cần OTP mới |
| DBR-03 | Chỉ lưu hash refresh token; logout thu hồi token tương ứng | Access token đã cấp còn hiệu lực đến expiry nếu không có kiểm tra thu hồi trực tuyến |
| DBR-04 | SĐT canonical là chữ số mã quốc gia không dấu +, dài 9–15 | Chấp nhận dấu + ở đầu rồi bỏ; không tự suy đoán 0 đầu thành +84 |
| DBR-05 | Chỉ sửa hồ sơ/xe của mình | 404 với xe không thuộc mình; không lộ owner |
| DBR-06 | vehicles.is_active nghĩa xe được phép sử dụng | Không dùng nó làm cờ xe đang được chọn |
| DBR-07 | drivers.status dùng ONLINE/OFFLINE biểu diễn ý định | Phải đối chiếu enum/dữ liệu đang dùng trước triển khai |
| DBR-08 | Chọn xe hợp lệ trong Redis state.vehicle_id | Mất cache khi chưa có chuyến: cần chọn lại |
| DBR-09 | Bật ONLINE phải có hồ sơ/xe hợp lệ | ONLINE chưa chứng minh có kết nối/GPS hoặc không có chuyến |
| DBR-10 | OFFLINE không hủy chuyến đang chạy | Chặn xét lời mời mới; không tuyên bố thu hồi atomically offer đang xử lý |
| DBR-11 | Chọn lại xe/sửa thông tin định danh xe yêu cầu OFFLINE, không có chuyến active | Check active qua Trip là đọc tại một thời điểm, chưa khóa xuyên service |
| DBR-12 | Chuyến được gán dùng vehicleId/snapshot của Trip | Xe chọn mới không sửa assignment hoặc lịch sử cũ |
| DBR-13 | Không xóa cứng tài xế/xe qua API v1 | Giữ ID để chuyến cũ còn tham chiếu |
| DBR-14 | Redis mất dữ liệu hoặc dependency không rõ: không quảng bá AVAILABLE | An toàn hơn việc tự đoán tài xế rảnh |

SĐT canonical và enum status là đề xuất có thể khác dữ liệu nhóm hiện tại. Nếu phát hiện khác, viết adapter tương thích và chốt cách chuẩn hóa dữ liệu; không tự đổi dữ liệu live. password_hash vẫn giữ nguyên, không trả qua API, không bắt buộc dùng trong luồng OTP.

## 5. Trạng thái

| Nguồn | Trạng thái | Ý nghĩa |
| --- | --- | --- |
| drivers.status | ONLINE / OFFLINE | Ý định nhận cuốc bền vững |
| Redis state.status | AVAILABLE / BUSY / OFFLINE | Projection vận hành, có thể mất hoặc cũ |
| Redis state absent/unknown | Không đủ bằng chứng | Không dùng để chọn ứng viên |
| Trip | ASSIGNED / DRIVER_ARRIVED / IN_PROGRESS | Tài xế đã có chuyến active |
| Trip | COMPLETED / CANCELLED | Chuyến kết thúc; phải xét lại ONLINE và presence trước AVAILABLE |

Điều kiện ứng viên: ONLINE + xe hợp lệ + presence/GPS mới + không bị reservation + không có chuyến active được xác nhận. Trip vẫn là bên bảo vệ ràng buộc một assignment active kể cả cache sai.

Vòng đời Trip phải giữ: CREATED → SEARCHING → ASSIGNED → DRIVER_ARRIVED → IN_PROGRESS → COMPLETED; hủy trước IN_PROGRESS. Không dùng HEADING_TO_PICKUP/ARRIVED_AT_PICKUP/ON_TRIP trên wire. Nếu giao diện dùng tên cũ, chỉ mapping ở adapter UI.

## 6. Luồng nghiệp vụ

### UC-D01. Đăng nhập

Request OTP → phản hồi không lộ tài khoản tồn tại → xác minh challenge/SĐT/mã → tìm tài xế tồn tại → ghi hash refresh token → trả phiên DRIVER. Không tạo drivers thiếu hồ sơ. OTP và token không log. Challenge phải gắn với SĐT đã normalize. Mật khẩu hiện có không bị xóa/thay bằng mock value.

### UC-D02. Làm mới và đăng xuất

Refresh kiểm tra hash, hạn và revoked_at; khóa row token trong transaction, revoke token cũ và insert token mới cùng commit. Hai request refresh cùng token chỉ một thành công. App serialize refresh; nếu mất response sau rotation có thể phải đăng nhập lại vì không lưu raw token/replay receipt. Logout chỉ revoke refresh token được cung cấp, là thao tác có thể gọi lại.

### UC-D03. Hồ sơ

Đọc me chỉ của chủ thể. Sửa fullName/avatarUrl/licenseNumber được phép; không sửa id, phoneNumber, passwordHash hoặc status qua endpoint hồ sơ. Kiểm tra độ dài theo ERD. Giấy phép unique conflict được ánh xạ lỗi nghiệp vụ, không lộ tài khoản sở hữu nó.

### UC-D04. Đăng ký và cập nhật xe

Đăng ký xe gắn driverId từ JWT; validate mã loại xe do nhóm thống nhất, biển số chuẩn hóa, brandModel/color. Unique plate là bảo vệ cuối trước concurrent create. isActive default true là đề xuất nghiệp vụ do ứng dụng gán khi insert, không sửa default database. Sau create chưa tự chuyển ONLINE hoặc tự chọn xe. Update đọc đúng owner; thay trường quan trọng cần OFFLINE và Trip active=null, nếu Trip lỗi thì từ chối thay đổi. Không thêm updated_at vào vehicles.

### UC-D05. Chọn xe và bật nhận cuốc

Chọn xe khi OFFLINE và không có chuyến active; lưu vehicle_id vào key Redis hiện có. Bật nhận cuốc kiểm tra hồ sơ/xe, ghi status ONLINE và updated_at trong PostgreSQL. Redis cập nhật sau commit, không phải transaction chung. Nếu sync lỗi: trả kết quả ý định đã lưu với realtimeSync=PENDING; Gateway/Matching phải kiểm tra nguồn chuẩn, đối soát trước dùng cache. Không coi PENDING là đã sẵn sàng nhận cuốc.

### UC-D06. Tắt nhận cuốc

Ghi OFFLINE và cập nhật projection/loại khỏi tập ứng viên khi có thể. Chuyến hiện tại vẫn hoạt động; trạng thái hiển thị có thể BUSY. Offer đã gửi vẫn thuộc Matching: chính sách chấp nhận đồng thời OFFLINE phải được nhóm chốt; baseline chỉ cam kết ngừng cấp offer mới sau khi Matching quan sát trạng thái. Không cam kết OFFLINE và assignment là một transaction.

### UC-D07. Nhận chuyến và cập nhật hành trình

App nhận offer từ Matching qua Gateway → accept tới Matching → Matching lấy snapshot Driver và callback POST /internal/trips/:id/assignment → Trip commit ASSIGNED → app lấy active/chi tiết. Tài xế PATCH /trips/:id/status với version và Idempotency-Key; hủy qua POST /trips/:id/cancel. Driver không gọi callback thay Matching và không cập nhật Trip database.

### UC-D08. Reconnect và mất cache

App xác thực lại khi cần, GET Driver me/availability và GET /trips/active. Gateway không hạ BUSY chỉ vì socket disconnect. Nếu có active Trip, dùng vehicleId của Trip cho chuyến; nếu không có và không còn xe chọn thì yêu cầu chọn lại. GET active cần JWT người dùng; job nền không tự giả lập token tài xế. Driver reconciliation nền chỉ sửa phần dữ liệu nó có thẩm quyền, không tự kết luận Trip rảnh.

## 7. Phân tích tính nhất quán và giới hạn

Không có bảng version, request receipt, inbox hoặc outbox Driver. Không mô tả replay exactly-once, durable event publish hoặc rollback PostgreSQL+Redis là đã được bảo đảm. Write DB dùng transaction; command status là đặt giá trị, không toggle. Hai thao tác status đồng thời dùng thứ tự khóa/commit tại DB; projection Redis phải được serialize hoặc sửa bằng đối soát, không dùng timestamp client làm thứ tự.

Đọc active Trip rồi sửa xe không ngăn tuyệt đối assignment phát sinh sau lần đọc. Baseline yêu cầu OFFLINE và kiểm tra lại, giữ snapshot assignment; để cam kết cấm sửa tuyệt đối trong cuộc đua nhận cuốc cần handshake/reservation với Matching được review riêng. Đây là gap hợp đồng, không lấp bằng một Redis lock tự đặt hoặc giả định API Trip đã tồn tại.

## 8. Component và mốc validate

| Mã | Component | Kiểm chứng cần có |
| --- | --- | --- |
| D00 | Bootstrap/config/identity contract | Schema không đổi, port và JWT hợp lệ với Trip |
| D01 | Domain/value objects | SĐT, ownership, status, vehicle validation |
| D02 | Repositories/UnitOfWork | Unique/FK hiện có; rollback; không schema drift |
| D03 | OTP adapter | Expiry, wrong attempt, cooldown, consume-once |
| D04 | Auth/session | Rotation race, expiry, logout; không trả hash |
| D05 | Profile | Chỉ owner và đúng trường |
| D06 | Vehicle | Ownership, unique plate, giới hạn active trip |
| D07 | Availability/state | Set ONLINE/OFFLINE; cache lỗi không giả AVAILABLE |
| D08 | Trip/Matching/Gateway adapters | Snapshot đúng wire; không bịa internal Trip route |
| D09 | Controllers/OpenAPI | DTO, envelope, exposure, mã lỗi |
| D10 | Contract/e2e/ops | Luồng liên service, reconnect, rủi ro và rollback |

## 9. Tiêu chí nghiệm thu

| Mã | Tình huống | Mong đợi |
| --- | --- | --- |
| DAC-01 | SĐT + và không + cùng mã quốc gia | Cùng canonical; không tạo identity khác |
| DAC-02 | OTP sai/hết hạn/dùng lại/vượt số thử | Không cấp phiên |
| DAC-03 | Chưa tồn tại tài xế | Không tự tạo hồ sơ hoặc tiết lộ qua request OTP |
| DAC-04 | Hai refresh đồng thời | Chỉ một rotation commit |
| DAC-05 | Logout lặp | Token không dùng refresh được, không lỗi do đã revoke |
| DAC-06 | Đọc/sửa xe người khác | 404 và không thay đổi |
| DAC-07 | Hai create cùng biển số | Tối đa một row; xung đột rõ |
| DAC-08 | Bật ONLINE chưa chọn xe/xe inactive | 409, không công bố sẵn sàng |
| DAC-09 | OFFLINE giữa chuyến | Không hủy Trip; không cấp offer mới sau đồng bộ |
| DAC-10 | Redis chết sau DB commit | Báo ý định đã lưu/PENDING, có đối soát, không hoàn tác giả |
| DAC-11 | Cache/GPS mất hạn | Bị loại khỏi ứng viên; không tự hủy Trip |
| DAC-12 | Trip lỗi khi kiểm tra sửa xe | 503, không sửa xe |
| DAC-13 | Snapshot vehicleType/brandModel | Map đúng brand, giới hạn schema và quote type |
| DAC-14 | User tự gọi assignment/internal | Bị từ chối |
| DAC-15 | Event Trip trùng/cũ tại Gateway | Không lùi UI; đọc lại active sau reconnect |
| DAC-16 | Chuyển trạng thái/hủy | Theo đúng Trip draft, giữ key/version khi retry |
| DAC-17 | OTP/mock production | Startup fail; không log token/OTP |
| DAC-18 | Schema trước/sau | Không thêm/sửa/xóa cột, bảng, index bằng đợt này |

## 10. Đối chiếu 28 user story

| Story | Vai trò Driver v1 |
| --- | --- |
| US01, US09, US17 | Tài khoản/OTP khách thuộc User; Driver không triển khai story khách |
| US02, US03, US05, US07 | Địa điểm, bản đồ, quote và chọn loại xe thuộc app/Routing/Pricing/Trip |
| US04, US12, US16 | Payment/rating/khiếu nại khách ngoài v1 |
| US06, US11 | Hủy/lịch sử khách thuộc Trip |
| US08, US14, US15 | Hỗ trợ trạng thái tài xế; Trip/Gateway/Notification chịu phần realtime/push |
| US10 | Chat/gọi ngoài Driver v1 |
| US13 | Cung cấp snapshot hồ sơ/xe cho Matching; Trip trả sau assignment |
| US18 | Trip có phí/breakdown; không có hóa đơn/thanh toán trong v1 |
| US19 | Trong Driver: đăng nhập OTP cho tài khoản đã có |
| US20 | Trong Driver: đăng ký xe |
| US21 | Một phần: eligibility/snapshot; offer và quyết định ở Matching |
| US22 | Ngoài v1 cả tài liệu Trip hiện tại; chưa có endpoint thống kê |
| US23 | Trong Driver: ý định nhận cuốc; cần Gateway/Matching phối hợp |
| US24 | Trip sở hữu cập nhật trạng thái |
| US25 | App/Routing điều hướng |
| US26, US27 | Chat/khiếu nại tài xế ngoài v1 |
| US28 | Trong Driver: cập nhật phương tiện |

## 11. Review và bước tiếp theo

Các điểm cần chốt: ý nghĩa drivers.status thực tế; normalize SĐT/biển số; OTP provider và thời hạn; nullable/schema thật; JWT issuer/audience/JWKS dùng chung; mã loại xe; snapshot brandModel→brand; ownership Redis; giao thức presence; cách chặn sửa xe đồng thời accept; onboarding tài xế; receiver event Gateway có lưu bền vững theo yêu cầu Trip hay chưa.

Theo mẫu nhóm: review thiết kế từng D00–D10 trước code, review test trước commit/push. Đợt hiện tại chỉ tài liệu; không tự commit/push main hay tạo backend giả để gọi là hoàn thành.
