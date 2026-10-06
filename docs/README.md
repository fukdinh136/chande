# Tài liệu dự án Chande

Thư mục này lưu mục lục và tài liệu chung của dự án. Tài liệu nghiệp vụ riêng được lưu trong thư mục `docs` của từng service để làm cơ sở thiết kế, triển khai và nghiệm thu.

## Mục lục

| Service | Tài liệu | Nội dung |
| --- | --- | --- |
| Trip Service | [Nghiệp vụ Trip Service](../service/trip-service/docs/nghiep-vu.md) | Phạm vi v1, ranh giới service, quy tắc, vòng đời chuyến, luồng nghiệp vụ, component và tiêu chí validate |
| Trip Service | [Kiến trúc](../service/trip-service/docs/kien-truc.md) | Lớp/port/adapter, dữ liệu, transaction và luồng outbox |
| Trip Service | [Sơ đồ C4](../service/trip-service/docs/c4.md) | Context, container, component và code diagram theo triển khai hiện tại |
| Trip Service | [API](../service/trip-service/docs/api.md) | Request/response, model, xác thực, idempotency và mã lỗi |
| Trip Service | [Routes](../service/trip-service/docs/routes.md) | Đường dẫn public/internal/outbound, quyền và use case |
| Trip Service | [Deploy](../service/trip-service/docs/deploy.md) | Cấu hình, migration, phát hành, rollback và vận hành |
| Trip Service | [Báo cáo triển khai](../service/trip-service/docs/bao-cao-trien-khai.md) | Những phần đã làm, commit, kiểm thử, Docker và giới hạn tích hợp |
| Trip Service | [Tích hợp Routing + Price](../service/trip-service/docs/tich-hop-routing-price.md) | Luồng báo giá qua HTTP ba service, cấu hình local và kết quả kiểm thử |
| Routing Service | [Mục lục thiết kế](../service/routing-service/README.md) | Thiết kế theo C3 và OSRM, trạng thái triển khai và file cấu hình local |
| Routing Service | [Nghiệp vụ](../service/routing-service/docs/nghiep-vu.md) | Ranh giới, calculate route, ETA matrix, recalculate và user story |
| Routing Service | [Kiến trúc và C3](../service/routing-service/docs/kien-truc.md) | Dispatcher, bounded queue, worker pool, limiter, OSRM adapter, Realtime Client và chiều trả kết quả |
| Routing Service | [API](../service/routing-service/docs/api.md) | Contract Trip tương thích, full route, matrix lấy vị trí qua Realtime, recalculate và OSRM mapping |
| Routing Service | [Routes](../service/routing-service/docs/routes.md) | Inbound/outbound, caller scopes và private exposure |
| Routing Service | [Cấu hình](../service/routing-service/docs/cau-hinh.md) | Endpoint OSRM, proxy key tùy chọn, vehicle profiles và secrets |
| Routing Service | [Deploy](../service/routing-service/docs/deploy.md) | Kế hoạch local/production, dataset OSRM, probes, lifecycle và rollback |
| Routing Service | [OSRM Hà Nội](../service/routing-service/docs/osrm-ha-noi.md) | Backend CAR tự host Docker, cắt dataset, cấu hình Trip và kiểm thử Route/Table thật |
| Routing Service | [Realtime Client](../service/routing-service/docs/realtime-client.md) | ETA Matrix lấy vị trí driver trong bán kính 2 km qua client Routing để tính ETA trả Matching |
| Routing Service | [Kế hoạch phát triển](../service/routing-service/docs/ke-hoach-phat-trien.md) | F00–F11, dependency, acceptance, test và commit theo feature |
| Routing Service | [Báo cáo triển khai](../service/routing-service/docs/bao-cao-trien-khai.md) | Feature/commit/checks và giới hạn tích hợp thật |
| Price Service | [Thiết kế v1](../service/price-service/README.md) | Giá mở cửa CAR/BIKE, config sửa được, công thức và contract tương thích Trip |
| Price Service | [API và deploy](../service/price-service/docs/api.md) | Runtime NestJS, token, request/response, lỗi, policy và Docker |
| Matching Service | [Mục lục](../service/matching-service/README.md) | Nghiệp vụ, C3, API/routes, deploy và kế hoạch mời tài xế tuần tự |
| Matching Service | [Báo cáo triển khai](../service/matching-service/docs/bao-cao-trien-khai.md) | Feature/commit, kiểm thử, Docker và smoke CAR_4/CAR_7 Hà Nội |
| App (Frontend) | [Frontend Chande](../app/docs/frontend.md) | App khách theo thiết kế Stitch, dẫn đường tài xế bằng MapLibre Navigation SDK, cấu hình, build và việc còn lại |

## Cách sử dụng

- Đọc quy tắc đã xác nhận trước khi triển khai; các mặc định đề xuất được ghi riêng trong tài liệu.
- Theo yêu cầu triển khai mới nhất, thực hiện và kiểm thử từng feature nhỏ rồi commit/push `main`; người dùng review kết quả qua báo cáo triển khai.
- Khi thay đổi nghiệp vụ, cập nhật tài liệu và các tiêu chí nghiệm thu liên quan để tránh khác biệt giữa tài liệu và mã nguồn.
- Tài liệu tham chiếu và sơ đồ là đầu vào để đối chiếu; quyết định được người dùng xác nhận là cơ sở giải quyết khác biệt giữa các nguồn.
