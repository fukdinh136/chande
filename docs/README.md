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
| Trip Service | [Báo cáo triển khai](../service/trip-service/docs/bao-cao-trien-khai.md) | Những phần đã làm, commit, kiểm thử, Docker và giới hạn tích hợp |

## Cách sử dụng

- Đọc quy tắc đã xác nhận trước khi triển khai; các mặc định đề xuất được ghi riêng trong tài liệu.
- Theo yêu cầu triển khai mới nhất, thực hiện và kiểm thử từng feature nhỏ rồi commit/push `main`; người dùng review kết quả qua báo cáo triển khai.
- Khi thay đổi nghiệp vụ, cập nhật tài liệu và các tiêu chí nghiệm thu liên quan để tránh khác biệt giữa tài liệu và mã nguồn.
- Tài liệu tham chiếu và sơ đồ là đầu vào để đối chiếu; quyết định được người dùng xác nhận là cơ sở giải quyết khác biệt giữa các nguồn.
