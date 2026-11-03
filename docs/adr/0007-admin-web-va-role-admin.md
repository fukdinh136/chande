# ADR-0007: Admin web React riêng và role ADMIN

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Admin web (mới), API Gateway, User, Driver, Trip, Payment, Price |
| Rà soát | 2026-10-27 |
| Quy ước | [Format và số liệu](../quy-uoc-tai-lieu.md) |

## Trạng thái

Đề xuất — phase 2, cải tiến P2.4 trong [Kiến trúc mục tiêu](../kien-truc-muc-tieu.md).

## Bối cảnh

Phase 2 cần trang quản trị để duyệt tài xế, tra cứu chuyến và giao dịch, xem surge. App hiện có (`app/`) là Expo cho hai role Customer / Driver với hai APK riêng. User service hiện chỉ có role khách và tài xế.

Ứng dụng đặt xe lớn đều có console vận hành riêng, tách khỏi app người dùng, với phân quyền chặt.

## Quyết định

- **Ứng dụng mới** `admin/` ở root: Vite + React + TypeScript, build ra file tĩnh, phục vụ qua Nginx edge tại `/admin/`.
- **Xác thực:** User thêm role `ADMIN`. Tài khoản admin chỉ tạo bằng seed / lệnh vận hành, không có đăng ký công khai.
- **Phân quyền tại Gateway:** route `/api/v1/admin/**` yêu cầu JWT có role `ADMIN`, sau đó rewrite tới endpoint `/internal/admin/...` của từng service, kèm service token như các route nội bộ khác. Service không tự xử lý JWT admin.
- **Endpoint admin theo chủ sở hữu dữ liệu:**

| Service | Chức năng |
| --- | --- |
| Driver | Danh sách hồ sơ, duyệt / tạm khoá (`PENDING / APPROVED / SUSPENDED`) |
| Trip | Danh sách chuyến có lọc, chi tiết + lịch sử trạng thái, đánh giá |
| Payment | Giao dịch, số dư, công nợ tài xế |
| Price | Hệ số surge hiện tại theo ô, quản lý mã khuyến mãi |

- Không thêm service BFF riêng cho admin. Admin web tự ghép dữ liệu ở client. Thống kê tổng hợp lấy từ Grafana (nhúng panel), không dựng kho dữ liệu riêng.
- Mọi thao tác ghi của admin được log kèm `adminId` và `traceId`.

## Phương án đã cân nhắc

| Phương án | Lý do không chọn |
| --- | --- |
| Thêm role thứ ba vào app Expo (Expo web) | Trộn ba role trong một codebase vốn đã tách theo APK; khó phân quyền và khó trình bày trên C2 |
| Admin BFF service riêng | Thêm một service chỉ để ghép dữ liệu; không đáng trong 2–3 tuần |
| Admin truy cập thẳng DB các service | Phá ranh giới database-per-service |

## Hệ quả

- Tích cực: container mới rõ ràng trên C2; quyền admin kiểm ở một chỗ; mỗi service vẫn sở hữu dữ liệu của mình.
- Tiêu cực: thêm một frontend cần build và deploy; thêm nhiều endpoint admin cần test phân quyền.

## Tiêu chí hoàn thành

- Token không có role `ADMIN` gọi `/api/v1/admin/**` nhận 403 (có test ở Gateway).
- Duyệt một tài xế `PENDING` trên Admin; tài xế đó bắt đầu nhận offer.
- Admin xem được chi tiết chuyến, giao dịch ví của chuyến đó và hệ số surge khu vực.
