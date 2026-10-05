# Routes Driver Service

Ngày 05/10/2026. Route catalog 0.1 draft, chưa có controller chạy được. [API](api.md), [Kiến trúc](kien-truc.md), [Nghiệp vụ](nghiep-vu.md), [Deploy](deploy.md).

## 1. Exposure và prefix

Driver local port đề xuất 3003, không global prefix. Gateway thêm /api/v1 rồi bỏ prefix khi proxy. Trip giữ port draft 3001 và worker 3002; không lấy port 3001 cho Driver như các ví dụ cũ trong hội thoại. Production chỉ Gateway public HTTPS. /internal/*, /health/*, /docs, /openapi.json không proxy ra public.

JWT DRIVER cho tài khoản của mình; internal dùng X-Service-Token riêng Matching. Gateway giữ Authorization/X-Request-Id và không tự thay actor. Driver tự xác minh token và ownership. Authorization OTP public khác authorization me, không áp một JWT guard bắt buộc cho toàn bộ auth routes.

## 2. Routes người dùng

| Mã | Method | Route tại Driver | Route public đề xuất | Quyền | Component | Kết quả |
| --- | --- | --- | --- | --- | --- | --- |
| D01 | POST | /driver-auth/otp/request | /api/v1/driver-auth/otp/request | Public, rate limit | D03 OTP | 200 challenge |
| D02 | POST | /driver-auth/otp/verify | /api/v1/driver-auth/otp/verify | Challenge + OTP | D03/D04 | 200 Session |
| D03 | POST | /driver-auth/refresh | /api/v1/driver-auth/refresh | Refresh token | D04 Session | 200 Session mới |
| D04 | POST | /driver-auth/logout | /api/v1/driver-auth/logout | Refresh token | D04 Session | 200 loggedOut |
| D05 | GET | /drivers/me | /api/v1/drivers/me | DRIVER | D05 Profile | 200 profile |
| D06 | PATCH | /drivers/me | /api/v1/drivers/me | DRIVER | D05 Profile | 200 profile |
| D07 | GET | /drivers/me/vehicles | /api/v1/drivers/me/vehicles | DRIVER | D06 Vehicle | 200 items |
| D08 | POST | /drivers/me/vehicles | /api/v1/drivers/me/vehicles | DRIVER | D06 Vehicle | 201 Vehicle |
| D09 | PATCH | /drivers/me/vehicles/:vehicleId | /api/v1/drivers/me/vehicles/:vehicleId | DRIVER sở hữu | D06 Vehicle | 200 Vehicle |
| D10 | PUT | /drivers/me/selected-vehicle | /api/v1/drivers/me/selected-vehicle | DRIVER | D07 Availability | 200 Availability |
| D11 | GET | /drivers/me/availability | /api/v1/drivers/me/availability | DRIVER | D07 Availability | 200 Availability |
| D12 | PUT | /drivers/me/availability | /api/v1/drivers/me/availability | DRIVER | D07 Availability | 200 Availability |

Route ID D01–D12 ở đây là mã route; D00–D10 trong Nghiệp vụ là mã mốc component, không dùng hai loại ID thay thế nhau. Endpoint Driver không yêu cầu Idempotency-Key receipt, xem API mục 14. Không trả 201 khi chỉ phát hiện bản ghi trùng sau retry create.

## 3. Routes nội bộ và vận hành

| Mã | Method | Route | Quyền/exposure | Ý nghĩa |
| --- | --- | --- | --- | --- |
| I01 | GET | /internal/drivers/:driverId/eligibility?vehicleType=... | Matching credential, private | Eligibility hồ sơ + snapshot, không active-trip lease |
| H01 | GET | /health/live | Mạng vận hành | Process sống |
| H02 | GET | /health/ready | Mạng vận hành | DB/schema/config sẵn sàng |
| J01 | GET | /.well-known/jwks.json | Đích verifier tin cậy, không chứa private key | Public keys nếu Driver làm issuer |
| S01 | GET | /docs | Local/staging private | Swagger dự kiến |
| S02 | GET | /openapi.json | Local/staging private | OpenAPI dự kiến |

J01 là contract đề xuất khi Driver tự ký token, không tự sửa AUTH_JWKS_URL của Trip. Nếu dùng issuer chung bên ngoài thì issuer sở hữu JWKS và không triển khai J01 trùng. Không có Driver worker port vì không có outbox worker trong baseline.

## 4. Outbound và các API ứng dụng phối hợp

| Mã | Caller → đích | Method/route | Credential | Trạng thái |
| --- | --- | --- | --- | --- |
| O-D01 | Driver → Trip | GET /trips/active | JWT DRIVER chuyển tiếp từ request người dùng | Đã mô tả trong Trip draft, chưa implementation |
| O-D02 | Driver → OTP provider | Theo adapter provider được chọn | Secret provider | Chưa chọn; mock local không network |
| A-T01 | App → Gateway → Trip | GET /trips/active | JWT DRIVER | Đọc active hoặc null |
| A-T02 | App → Gateway → Trip | GET /trips/history | JWT DRIVER | Lịch sử phân trang |
| A-T03 | App → Gateway → Trip | GET /trips/:id | JWT DRIVER | Trip + statusHistory |
| A-T04 | App → Gateway → Trip | PATCH /trips/:id/status | JWT + Idempotency-Key | version + DRIVER_ARRIVED/IN_PROGRESS/COMPLETED |
| A-T05 | App → Gateway → Trip | POST /trips/:id/cancel | JWT + Idempotency-Key | version + reason, trước IN_PROGRESS |
| A-M01 | App → Gateway → Matching | Accept/decline offer: path chưa chốt | JWT DRIVER | Không tạo endpoint giả trong Driver |

O-D01 không có query driverId và không dùng token service thay JWT. Chưa có API nội bộ Trip cho lookup theo driverId; nếu cần poll nền phải đề xuất bổ sung với chủ Trip, không ghi là route đang tồn tại.

## 5. Callbacks/events hệ thống đã mô tả ở Trip

| Bên gửi → bên nhận | Route | Contract |
| --- | --- | --- |
| Matching → Trip | POST /internal/trips/:id/assignment | eventId + driver/vehicle IDs + snapshots; 200 đã commit |
| Trip worker → Gateway | POST /internal/events/trips | 202 sau lưu bền vững |
| Trip worker → Notification | POST /internal/events/trips | 202 sau lưu bền vững |

Driver không thêm bản sao /internal/events/trips trong baseline và không nhận callback assignment. Gateway muốn thông báo trạng thái Driver phải có hợp đồng riêng; hiện không được Trip mô tả và chưa triển khai trong ZIP.

## 6. Không có trong v1

Không có DELETE driver/vehicle, driver registration tự động từ OTP, đổi mật khẩu, admin duyệt xe, endpoint thống kê tháng, chat, complaint, payment, invoice, driver trip-status alias hoặc service-token lookup Trip. Không dùng API của tài xế để gọi nội bộ assignment.

## 7. Checklist review route

- [ ] D01–D12 khớp DTO/response/lỗi trong API; không public I01.
- [ ] vehicleId/driverId UUID, query vehicleType có giới hạn 20 theo ERD.
- [ ] Gateway route chính xác, không đụng namespace auth của khách.
- [ ] Driver me lấy sub; xe người khác trả 404.
- [ ] JWT/JWKS/issuer/audience đã thống nhất với Trip và Gateway.
- [ ] O-D01 dùng đúng envelope data TripDTO/null và timeout; không gọi HTTP trong DB transaction.
- [ ] Swagger/probe không chứa secret và không public mặc định.
- [ ] App lưu đúng key/version khi gọi Trip, không dùng key giả để hứa replay Driver.
