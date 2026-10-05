# Nghiệp vụ Driver

Tài liệu mô tả hành vi trong mã hiện tại. “Có implementation” không đồng nghĩa đã kiểm chứng với database, service thật hoặc thiết bị. [API](api.md), [Kiến trúc](kien-truc.md), [Routes](routes.md), [Deploy](deploy.md).

## 1. Phạm vi và chủ sở hữu

| Thành phần | Trách nhiệm |
| --- | --- |
| Driver | Identity, OTP/session, hồ sơ, xe, xe chọn, ý định nhận cuốc, eligibility/snapshot |
| Realtime | GPS foreground, freshness vị trí, nearby cho Routing |
| Matching | Offer, accept/decline, reservation; chưa tích hợp trong app Driver |
| Trip | Assignment, trạng thái và lịch sử chuyến |
| Gateway chính thức | Ingress/proxy, xác thực và event contract do nhóm triển khai |

Không mở đăng ký Driver mới, payment, rating, admin, chat, khiếu nại hoặc thu nhập.

## 2. OTP và phiên

- Số điện thoại Việt Nam chuẩn hóa về mã quốc gia 84; không truncate.
- OTP chỉ đăng nhập tài xế đã tồn tại. API request không tiết lộ account tồn tại hoặc trả OTP.
- OTP gắn phone/challenge, hết hạn, giới hạn số lần sai và consume một lần. Local default: sáu chữ số, TTL 300 s, cooldown 60 s, tối đa 5 lần; có cấu hình.
- Mock OTP/rate limit ở một process, mất khi restart, không hỗ trợ nhiều instance. Provider adapter chỉ dùng sau khi xác nhận contract; chưa chứng minh provider thật.
- Access token RS256 với sub/role DRIVER/issuer/audience/expiry. Refresh opaque chỉ lưu hash; revoke token cũ và thêm token mới cùng transaction dưới row lock.
- Hai refresh cùng token: tối đa một rotation thành công nếu database/constraint hoạt động đúng. App serialize refresh; không dựa vào retry bằng token đã bị revoke.
- Logout revoke refresh; access token/socket JWT chưa có cơ chế revoke tức thì, còn hiệu lực đến expiry. App đóng GPS và dọn phiên khi logout.
- OTP consume thành công nhưng lưu session thất bại có thể cần request challenge mới; không có receipt replay OTP.

## 3. Hồ sơ và phương tiện

Hồ sơ gồm fullName, avatarUrl, licenseNumber, phoneNumber và desiredStatus. Chỉ fullName/avatarUrl/licenseNumber được cập nhật. Không đổi phone/ID. Hồ sơ đủ tên, điện thoại, giấy phép trước ONLINE.

Giấy phép thay đổi, xe cập nhật và xe chọn yêu cầu Driver OFFLINE và không có active Trip tại lần đọc bằng JWT người dùng. Sửa tên/avatar không cần kiểm Trip. Đăng ký xe mới không tự chọn xe và không thay xe chuyến đang chạy.

Xe phải thuộc actor JWT, active, thuộc loại được cấu hình; mặc định BIKE/CAR_4/CAR_7. Truy cập xe người khác trả 404. Input vừa giới hạn cột: licenseNumber 20, plate 15, brandModel 100, color 30; không truncate. Unique plate/license phụ thuộc constraint PostgreSQL có sẵn; không tạo constraint bằng code.

Vô hiệu hóa xe chọn: commit xe trước, sau đó clear selection có điều kiện trong Redis. Redis lỗi không khôi phục xe active; GET availability thử cleanup lại. Eligibility đọc owner/active từ PostgreSQL, từ chối cache selection cũ.

## 4. Ý định và vận hành

| Dữ liệu | Giá trị | Nguồn |
| --- | --- | --- |
| PostgreSQL drivers.status | ONLINE / OFFLINE | Ý định bền vững |
| Redis driver:{id}:availability | ONLINE / OFFLINE | Projection của ý định |
| Redis driver:{id}:state.status | AVAILABLE / BUSY / OFFLINE | Projection vận hành |
| API realtimeStatus | Ba giá trị trên hoặc UNKNOWN | UNKNOWN khi thiếu dữ liệu đáng tin |
| API realtimeSync | APPLIED / PENDING | Kết quả đồng bộ, không phải khả năng nhận cuốc |

ONLINE yêu cầu hồ sơ đủ và xe chọn hợp lệ. DB commit thành công rồi Redis lỗi trả 200 với desiredStatus đã lưu, realtimeSync PENDING, realtimeStatus UNKNOWN và selectedVehicleId null. DB chưa commit không trả thành công.

OFFLINE vẫn lưu được khi Redis/Trip lỗi; không gọi cancel, không kết thúc chuyến. Redis giữ BUSY. Không dùng disconnect, GPS stale hoặc reservation TTL để kết luận hết chuyến.

Cache mất: GET availability đọc ý định PG, reconcile projection, không tự tạo selection hoặc AVAILABLE. Đổi ý định ONLINE vô hiệu hóa trạng thái cũ nếu chưa BUSY; AVAILABLE cần nguồn xác minh xe/presence/Trip. Nguồn đó chưa được nối đầy đủ sau khi bỏ Gateway demo; Realtime chỉ nhận GPS, không ghi AVAILABLE.

Selection hiện chỉ lưu Redis, mất cache có thể phải chọn lại. Đổi selection chỉ khi OFFLINE/no active Trip tại thời điểm đọc; không có lease chung ngăn assignment xảy ra ngay sau đó.

## 5. Eligibility và snapshot

Matching GET nội bộ trả profileEligible, desiredStatus, vehicleId, reasons và snapshot nếu hồ sơ/xe hợp lệ; không chứng minh presence, operational availability, reservation hoặc Trip rảnh.

Realtime POST batch trả eligible, availabilityKnown, vehicleType, operationalStatus và reasons. Mỗi batch 1–100 UUID không trùng, tối đa bốn lượt kiểm tra song song. Legacy, OFFLINE, xe sai owner/inactive/sai loại hoặc hồ sơ thiếu đều bị từ chối. ONLINE/hồ sơ/xe hợp lệ nhưng UNKNOWN trả availabilityKnown=false; Realtime xử lý thành lỗi rõ thay vì danh sách rỗng giả.

Snapshot trả brand từ nguyên chuỗi brand_model; không bịa phân tách brand/model. Không công khai licenseNumber/credential qua nearby.

## 6. Legacy và schema

PENDING/ACTIVE/BLOCKED hoặc status khác không được ánh xạ tự động. Domain trả DRIVER_STATUS_MIGRATION_REQUIRED; schema inspector có thể chặn toàn service nếu còn bất kỳ row legacy nào. Không chuyển BLOCKED thành OFFLINE để bỏ khóa tài khoản.

Trước khi vận hành, owner dữ liệu cần cung cấp DDL/metadata, kiểm CHECK/type/default/unique/FK và chốt xử lý legacy cùng cơ chế khóa account. Nếu constraint không cho ONLINE/OFFLINE thì xung đột với yêu cầu giữ schema; cần owner quyết định, không tự đổi DDL.

## 7. App và Trip

App trong app/src/features/driver gọi Driver trực tiếp. Có restore phiên, single-flight refresh, hồ sơ/xe, ONLINE/OFFLINE/PENDING, active/history/detail và command Trip. GPS foreground có module riêng nối Realtime; Matching và thông báo chuyến realtime chưa được cấu hình.

Trip giữ CREATED → SEARCHING → ASSIGNED → DRIVER_ARRIVED → IN_PROGRESS → COMPLETED; CANCELLED theo chính sách trước IN_PROGRESS. Driver không sở hữu assignment/status/cancel.

Command Trip giữ cùng key/body/version khi retry mạng/5xx. Version conflict đọc lại rồi hành động mới dùng key mới. Replay cũ không làm giảm version UI. Reconnect/focus đọc lại active Trip, không coi trạng thái cache là kết quả hiện tại.

## 8. Tiêu chí cần kiểm chứng

OTP sai/hết hạn/reuse; refresh đồng thời/rollback; ownership và unique với DB; xe inactive/cache cũ; ONLINE thiếu xe; OFFLINE giữa chuyến; Redis lỗi sau commit; cache loss/reconcile; race nhiều process; JWT trust Trip/Realtime; Trip replay/conflict/cancel; session restore và GPS cleanup/reconnect trên thiết bị.

Các ca chạy storage cần target riêng được xác nhận. Danh sách này là tiêu chí nghiệm thu, không phải nhật ký test pass.
