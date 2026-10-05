# Báo cáo triển khai Routing Service

Ngày: 06/10/2026. Cập nhật theo từng feature; kết quả kiểm thử dưới đây dùng fixture/mock, không xác nhận dataset/profile OSRM thật.

| Feature | Kết quả | Kiểm thử | Commit |
| --- | --- | --- | --- |
| Thiết kế | Tài liệu TypeScript, OSRM, ETA qua Realtime Client | Review contract và liên kết | `b075f55` |
| F00 | Package/lockfile, compiler strict, secrets/env/profile loader | 8 unit tests, lint/typecheck/build đạt | `713a4ff` |
| F01 | Domain, chuẩn hóa số đo, snapshot driver và ports độc lập NestJS | 11 tests tổng; bounds, overflow, duplicate/timestamp | Xem lịch sử `feat(routing): define route models and provider ports` |
| F02 | Mock và OSRM Route/Table, fetch có giới hạn/cancel, polyline6 và error mapping | 17 tests tổng; 6 adapter contract tests dùng HTTP fixture | Xem lịch sử `feat(routing): add OSRM route and table adapters` |

## Đầu vào tích hợp còn thiếu

- Realtime: method/path, authentication và response thật. Chưa tự đặt contract wire; chỉ triển khai port/mock trước.
- OSRM: endpoint, dataset/version/algorithm và profile xe máy đã kiểm chứng. `BIKE` chưa bật; không thay bằng profile ô tô.
- Một process/replica; cấu hình mặc định chưa được benchmark production.

Các file `.env` và `config/vehicle-profiles.json` local giữ nguyên và được Git ignore. Nghiệp vụ và source Trip Service giữ nguyên.
