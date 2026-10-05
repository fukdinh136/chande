# Routes Trip Service

Ngày cập nhật: 05/10/2026. R01–R08 và probes đã triển khai; Swagger bật được ở local. Outbound dùng HTTP adapter và mock đúng contract; Gateway/service thật chưa tích hợp.

Chi tiết request/response và lỗi nằm trong [API](api.md). Trách nhiệm component nằm trong [Kiến trúc](kien-truc.md). Chính sách quyền/trạng thái nằm trong [Nghiệp vụ](nghiep-vu.md).

## 1. Đường dẫn và exposure

- Trip HTTP API dùng port đề xuất `3001`, không có global prefix: `/trips/...` và `/internal/...`.
- Gateway public đề xuất prefix `/api/v1`, bỏ prefix khi proxy đến Trip. Prefix này là đề xuất tích hợp, không phải Gateway đã được triển khai.
- Local test gọi trực tiếp `http://localhost:3001`; production ứng dụng chỉ gọi Gateway HTTPS.
- `/internal/*`, `/health/*`, `/docs` và `/openapi.json` không được proxy ra public Gateway.
- Worker dùng port probe đề xuất `3002`, không phục vụ API người dùng. Các probe chỉ mở trong mạng vận hành.

## 2. Route người dùng

| Mã | Method | Route tại Trip | Route public đề xuất | Quyền | Use case / component | Thành công |
| --- | --- | --- | --- | --- | --- | --- |
| R01 | POST | `/trips/estimate` | `/api/v1/trips/estimate` | RIDER | Estimate / C06 | 200 quote |
| R02 | POST | `/trips` | `/api/v1/trips` | RIDER | Create / C09 | 201 Trip `SEARCHING` |
| R03 | GET | `/trips/active` | `/api/v1/trips/active` | RIDER hoặc DRIVER, của mình | Get / C11 | 200 Trip hoặc null |
| R04 | GET | `/trips/history` | `/api/v1/trips/history` | RIDER hoặc DRIVER, của mình | Get / C11 | 200 trang lịch sử |
| R05 | GET | `/trips/:id` | `/api/v1/trips/:id` | Khách sở hữu hoặc tài xế được gán | Get / C11 | 200 chi tiết + history |
| R06 | PATCH | `/trips/:id/status` | `/api/v1/trips/:id/status` | DRIVER được gán | Update / C12 | 200 Trip sau cập nhật |
| R07 | POST | `/trips/:id/cancel` | `/api/v1/trips/:id/cancel` | Khách sở hữu hoặc DRIVER được gán, trước khi bắt đầu | Cancel / C13 | 200 Trip `CANCELLED` |

R02/R06/R07 yêu cầu `Idempotency-Key`. R06/R07 nhận version trong body. Actor luôn lấy từ JWT được xác minh; GET không nhận rider/driver ID để chọn chủ sở hữu.

### Thứ tự định tuyến

Đăng ký `/trips/active` và `/trips/history` trước `/trips/:id`. `:id` phải là UUID. Kiểm thử route tĩnh không bị chuyển vào handler lấy theo ID; không coi `active`/`history` là ID lỗi.

Trình tự xử lý: route → xác thực identity → validation DTO/path/query → kiểm tra quyền role → use case kiểm tra sở hữu/state/version → mapper response/error. Với resource người gọi không được phép xem, trả 404 trước khi tiết lộ status hoặc version.

## 3. Route nội bộ và vận hành

| Mã | Method | Route | Bên gọi | Xác thực / exposure | Component |
| --- | --- | --- | --- | --- | --- |
| R08 | POST | `/internal/trips/:id/assignment` | Matching | Private network + `X-Service-Token` của Matching | Receive Assignment / C10 |
| R09 | GET | `/health/live` trên API:3001 | Runtime/probe | Mạng vận hành, không JWT người dùng | Health API |
| R10 | GET | `/health/ready` trên API:3001 | Runtime/probe | Mạng vận hành, không JWT người dùng | DB + schema readiness |
| R11 | GET | `/docs` trên API:3001 | Developer local/staging | Bật khi được cấu hình; production mặc định tắt | Swagger UI dự kiến |
| R12 | GET | `/openapi.json` trên API:3001 | Developer/contract CI | Cùng chính sách R11 | OpenAPI sinh từ controller dự kiến |
| W01 | GET | `/health/live` trên worker:3002 | Runtime/probe | Private; không proxy Gateway | Worker liveness |
| W02 | GET | `/health/ready` trên worker:3002 | Runtime/probe | Private; không proxy Gateway | DB/schema + dispatch loop readiness |

R08 dùng `eventId` trong body để chống callback lặp; không dùng `Idempotency-Key` thay event ID. Probe chỉ trả trạng thái tối thiểu, không trả credential, connection string hoặc stack trace.

## 4. Các route Trip gọi ra ngoài

Các route dưới đây là contract đã dùng trong adapter và mock của Trip. Service thật cần xác nhận trước tích hợp. Mỗi đích dùng base URL/credential riêng trong [Deploy](deploy.md).

| Mã | Đích | Method và route | Bên gửi | Vai trò | ACK thành công |
| --- | --- | --- | --- | --- | --- |
| O01 | Routing | `POST /internal/routes/estimate` | Routing Client trong Estimate | Lấy route summary | 200 dữ liệu |
| O02 | Pricing | `POST /internal/fares/estimate` | Pricing Client trong Estimate | Lấy giá/breakdown | 200 dữ liệu |
| O03 | Matching | `POST /internal/matching/requests` | Outbox Worker qua Matching Client | Lưu yêu cầu tìm xe, chưa gán ngay | 202 đã lưu bền vững |
| O04 | Matching | `POST /internal/matching/requests/:tripId/cancel` | Outbox Worker qua Matching Client | Dừng tìm/giải phóng; terminal marker chống lệnh đến muộn | 202 đã lưu bền vững |
| O05 | Gateway | `POST /internal/events/trips` | Outbox Worker | Cấp event cho realtime | 202 đã lưu bền vững |
| O06 | Notification | `POST /internal/events/trips` | Outbox Worker | Cấp event cho thông báo | 202 đã lưu bền vững |
| O07 | Matching | `POST /internal/events/trips` | Outbox Worker, chỉ `trip.completed` | Kết thúc reservation khi hoàn thành, giữ terminal marker | 202 đã lưu bền vững |

O03/O04 có command ID; O05/O06/O07 có event ID. Matching callback R08 sau khi tài xế chấp nhận. Người dùng không gọi R08 hoặc O03/O04 trực tiếp để tự gán tài xế. O07 bổ sung contract giải phóng reservation sau COMPLETED; xem API.

## 5. Route không có trong v1

Không thêm API Trip cho chấp nhận/bỏ qua lời mời, online/offline tài xế, GPS streaming, thanh toán, hóa đơn, rating, khiếu nại hoặc tìm lại sau tài xế hủy. Chấp nhận/bỏ qua lời mời thuộc Matching; Trip chỉ xác nhận kết quả qua R08.

Không có route ép trạng thái `ASSIGNED`, `SEARCHING` hoặc `CANCELLED` qua R06; không có route tự kết thúc tìm xe theo thời gian. Đổi điểm/loại xe phải estimate mới và tạo chuyến theo chính sách active, không PATCH hành trình của chuyến hiện tại.

## 6. Checklist validate routes

- [ ] R01–R08 khớp request/response và quyền trong API.
- [ ] Route tĩnh không bị `:id` che; UUID/query sai trả lỗi input.
- [ ] Gateway chỉ proxy R01–R07, giữ token và request key cần thiết.
- [ ] API xác minh token và quyền sở hữu, không chỉ dựa vào Gateway.
- [ ] Internal callback có credential riêng; public actor không dùng được.
- [ ] Probe và Swagger đúng port/môi trường, không public ngoài ý muốn.
- [x] O01–O07 có HTTP adapter/mock; contract với service thật còn cần xác nhận.

## 7. Routes riêng của bộ mock local

Mock ở port 3003, chỉ dùng môi trường development; không thuộc API Trip/Gateway và bị chặn khi `NODE_ENV=production`.

| Method | Route | Mục đích |
| --- | --- | --- |
| GET | `/jwks` | Public key của issuer thử; khóa đổi khi mock restart |
| GET | `/health/live` | Probe mock |
| POST | `/mock/token` | `{sub: UUID, role: RIDER/DRIVER}` → JWT thử |
| POST | `/mock/accept` | `{tripId, ...Assignment}` → mô phỏng tài xế chấp nhận và gọi R08; retry cùng eventId |

Mock giữ command/event receipt và terminal marker trong volume để kiểm thử restart; không tự chọn/gán tài xế. Giá mock là giá cố định để kiểm chứng Trip, không đại diện Pricing thật.
