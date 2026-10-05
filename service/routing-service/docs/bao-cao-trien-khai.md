# Báo cáo triển khai Routing Service

Ngày: 06/10/2026. Cập nhật theo từng feature; kết quả kiểm thử dưới đây dùng fixture/mock, không xác nhận dataset/profile OSRM thật.

| Feature | Kết quả | Kiểm thử | Commit |
| --- | --- | --- | --- |
| Thiết kế | Tài liệu TypeScript, OSRM, ETA qua Realtime Client | Review contract và liên kết | `b075f55` |
| F00 | Package/lockfile, compiler strict, secrets/env/profile loader | 8 unit tests, lint/typecheck/build đạt | `713a4ff` |
| F01 | Domain, chuẩn hóa số đo, snapshot driver và ports độc lập NestJS | 11 tests tổng; bounds, overflow, duplicate/timestamp | Xem lịch sử `feat(routing): define route models and provider ports` |
| F02 | Mock và OSRM Route/Table, fetch có giới hạn/cancel, polyline6 và error mapping | 17 tests tổng; 6 adapter contract tests dùng HTTP fixture | Xem lịch sử `feat(routing): add OSRM route and table adapters` |
| F03 | Token bucket request/burst và sliding-window budget matrix theo từng attempt | 4 tests dùng fake monotonic clock; 21 tests tổng | Xem lịch sử `feat(routing): bound outbound request and matrix rates` |
| F04 | Bounded queue, pool async, deadline/cancel, retry qua limiter, bounded shutdown | 4 tests concurrency/cancel/deadline/shutdown; 25 tests tổng | Xem lịch sử `feat(routing): dispatch jobs through bounded worker pool` |

Queue đầy trả `ROUTING_BUSY` ngay, nằm trong admission budget; không tạo hàng đợi chờ admission ngoài capacity. Queue age vẫn bị giới hạn riêng. Limiter chạy trong worker, mọi retry cần permit mới.

## Đầu vào tích hợp còn thiếu

- Realtime: method/path, authentication và response thật. Chưa tự đặt contract wire; chỉ triển khai port/mock trước.
- OSRM: endpoint, dataset/version/algorithm và profile xe máy đã kiểm chứng. `BIKE` chưa bật; không thay bằng profile ô tô.
- Một process/replica; cấu hình mặc định chưa được benchmark production.

Các file `.env` và `config/vehicle-profiles.json` local giữ nguyên và được Git ignore. Nghiệp vụ và source Trip Service giữ nguyên.
