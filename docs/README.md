# Tài liệu dự án Chande

Thư mục này lưu mục lục và tài liệu chung của dự án. Tài liệu nghiệp vụ riêng được lưu trong thư mục `docs` của từng service để làm cơ sở thiết kế, triển khai và nghiệm thu.

## Mục lục

| Service | Tài liệu | Nội dung |
| --- | --- | --- |
| Trip Service | [Nghiệp vụ Trip Service](../service/trip-service/docs/nghiep-vu.md) | Phạm vi v1, ranh giới service, quy tắc, vòng đời chuyến, luồng nghiệp vụ, component và tiêu chí validate |
| Trip Service | [Kiến trúc](../service/trip-service/docs/kien-truc.md) | Lớp/port/adapter, dữ liệu, transaction và luồng outbox |
| Trip Service | [API](../service/trip-service/docs/api.md) | Request/response, model, xác thực, idempotency và mã lỗi |
| Trip Service | [Routes](../service/trip-service/docs/routes.md) | Đường dẫn public/internal/outbound, quyền và use case |
| Trip Service | [Deploy](../service/trip-service/docs/deploy.md) | Cấu hình, migration, phát hành, rollback và vận hành |

## Cách sử dụng

- Đọc quy tắc đã xác nhận trước khi triển khai; các mặc định đề xuất được ghi riêng trong tài liệu.
- Duyệt thiết kế từng component trước khi code, sau đó duyệt kết quả kiểm thử trước khi commit và push `main`.
- Khi thay đổi nghiệp vụ, cập nhật tài liệu và các tiêu chí nghiệm thu liên quan để tránh khác biệt giữa tài liệu và mã nguồn.
- Tài liệu tham chiếu và sơ đồ là đầu vào để đối chiếu; quyết định được người dùng xác nhận là cơ sở giải quyết khác biệt giữa các nguồn.
