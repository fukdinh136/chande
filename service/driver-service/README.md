# Driver Service

Service quản lý tài khoản, phiên đăng nhập, hồ sơ, phương tiện và ý định nhận cuốc của tài xế Chande.

## Tài liệu

| Tài liệu | Nội dung |
| --- | --- |
| [Nghiệp vụ](docs/nghiep-vu.md) | Phạm vi v1, quy tắc, user story, luồng và tiêu chí nghiệm thu |
| [Kiến trúc](docs/kien-truc.md) | C3, domain/port/adapter, dữ liệu giữ nguyên và giới hạn nhất quán |
| [API](docs/api.md) | Model, OTP/JWT, request/response, lỗi và hợp đồng phối hợp Trip |
| [Routes](docs/routes.md) | Route public/internal/outbound, quyền và exposure |
| [Deploy](docs/deploy.md) | Runtime, config, kiểm tra schema, phát hành và vận hành |

[Mục lục chung](../../docs/README.md). [Tài liệu Trip đối chiếu](../trip-service/README.md).

## Trạng thái và phạm vi đợt này

Ngày 05/10/2026; thiết kế 0.1 draft. Chỉ tạo tài liệu theo đúng sáu file của mẫu Trip Service. Chưa có backend Driver, controller, package, Dockerfile, migration, OpenAPI hoặc kết quả integration test. Không sửa code app, tài liệu Trip hay database. Không commit/push/deploy.

Ràng buộc người dùng: giữ nguyên `drivers`, `vehicles`, `driver_refresh_tokens` và các nhóm key Redis trong ERD. Không thêm availability/outbox/inbox/receipt table, cột trạng thái hay version. Stack dự kiến: NestJS, TypeScript, TypeORM, PostgreSQL, Redis; domain/application độc lập framework như Trip.

## Kết quả phân tích bộ ZIP

| Nguồn đã đọc | Kết quả thực tế | Hệ quả cho Driver |
| --- | --- | --- |
| `docs/README.md` | Mục lục; nghiệp vụ chi tiết dẫn đến service Trip | Không có bộ yêu cầu chung khác trong folder docs |
| `service/trip-service/README.md` và năm file docs | Thiết kế, chưa có ứng dụng backend | Route/event của Trip là draft, chưa được gọi thử |
| Trip nghiệp vụ và API | Matching nhận accept/decline; Trip xác nhận assignment | Driver không tạo API tự gán chuyến |
| Trip kiến trúc/deploy | REST callback + outbox, chưa dùng broker cho Trip v1 | Không đưa broker hoặc Trip→Driver event receiver vào baseline như đã có |
| Trip API | `ASSIGNED → DRIVER_ARRIVED → IN_PROGRESS → COMPLETED` | Không dùng enum mock cũ làm wire contract |
| Trip phạm vi | Thống kê tháng, chat, khiếu nại, payment/invoice ngoài v1 | Ghi rõ chưa được đáp ứng, không bịa endpoint |
| `app/package.json`, `app/src/app/*`, components và tìm kiếm toàn `app/src` | Expo 57 starter, Home/Explore mẫu; chưa thấy API client, auth, socket hay luồng chuyến | Phối hợp app trong tài liệu là kế hoạch triển khai, không mô tả code đã có |
| `app/AGENTS.md` | Quy tắc Expo/version docs và kiểm tra khi sửa app | Không sửa app trong đợt này; chưa chạy lint/typecheck app vì không thay mã ứng dụng |

ZIP không có DDL/entity backend để xác nhận nullable, default hay enum CHECK của database. Mapping Driver dựa trên ảnh ERD đã được cung cấp trong hội thoại. Khi có DDL thật phải đối chiếu trước khi code; không chạy ORM synchronize để làm database giống tài liệu.

## Khác biệt quan trọng với thiết kế trước trong hội thoại

- Matching là thành phần riêng theo tài liệu nhóm; không chuyển vào Trip.
- Trạng thái chuyến và route dùng đúng draft Trip; accept/decline không thuộc Trip hoặc Driver.
- `GET /trips/active` lấy chủ thể từ JWT, không có query driverId/service-token lookup.
- Event Trip chỉ gửi Gateway/Notification; Driver không tự nhận event bằng endpoint chưa được Trip hỗ trợ.
- Giữ schema Driver đồng nghĩa không có durable outbox hoặc replay receipt giống Trip; dùng đọc lại/đối soát và công bố rõ giới hạn.
- PostgreSQL `status`, cách chọn xe, OTP và JWT bên dưới là đề xuất cần review, không phải quyết định nhóm đã xác nhận.

## Cách dùng bộ file

Giải nén ở gốc dự án: tạo `service/driver-service/`; cập nhật `docs/README.md` đã bổ sung liên kết Driver. Nếu mục lục của nhóm đã thay đổi sau bản ZIP, chỉ ghép năm dòng Driver vào file hiện tại, không ghi đè thay đổi mới của thành viên khác.

Đọc Nghiệp vụ → Kiến trúc → API/Routes → Deploy. Chốt các mục tích hợp chưa xác nhận trong API trước khi triển khai. Việc tạo tài liệu đã được yêu cầu; quy trình duyệt component trước code của mẫu Trip được giữ cho giai đoạn tiếp theo, không phải lý do dừng viết tài liệu.
