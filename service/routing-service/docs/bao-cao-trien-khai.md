# Báo cáo triển khai Routing Service

Ngày: 06/10/2026. Cập nhật theo từng feature; kết quả kiểm thử dưới đây dùng fixture/mock, không xác nhận dataset/profile OSRM thật.

| Feature | Kết quả | Kiểm thử | Commit |
| --- | --- | --- | --- |
| Thiết kế | Tài liệu TypeScript, OSRM, ETA qua Realtime Client | Review contract và liên kết | `b075f55` |
| F00 | Package/lockfile, compiler strict, secrets/env/profile loader | 8 unit tests, lint/typecheck/build đạt | `713a4ff` |
| F01 | Domain, chuẩn hóa số đo, snapshot driver và ports độc lập NestJS | 11 tests tổng; bounds, overflow, duplicate/timestamp | `8659ba3` |
| F02 | Mock và OSRM Route/Table, fetch có giới hạn/cancel, polyline6 và error mapping | 17 tests tổng; 6 adapter contract tests dùng HTTP fixture | `175d442` |
| F03 | Token bucket request/burst và sliding-window budget matrix theo từng attempt | 4 tests dùng fake monotonic clock; 21 tests tổng | `0f77ffb` |
| F04 | Bounded queue, pool async, deadline/cancel, retry qua limiter, bounded shutdown | 4 tests concurrency/cancel/deadline/shutdown; 25 tests tổng | `5240162` |
| F05 | Calculate Route: estimate strict hai trường, full route; validate trước dispatch | 27 tests tổng; invalid vehicle/input không gọi provider | `5956fbe` |
| F06 | NestJS API, caller tokens/scopes, strict DTO/envelope, correlation, OpenAPI và probes | 31 tests tổng; HTTP lỗi/size/auth và `app.close()` với request đang chạy | `dc6a133` |
| F07 | Cross-service test dùng `RoutingClient` và `EstimateTrip` thật qua Routing HTTP | 2 cross-service tests; failure/timeout không gọi Pricing hoặc lưu quote | `78b57a3` |
| F11 (phần port/mock) | Realtime Client validate snapshot, timeout/cancel/response cap; mock vị trí quanh pickup | 3 unit tests; HTTP adapter thật chờ contract | `f29df4c` |
| F08 | ETA Matrix gọi Realtime, batch driver→pickup, giữ metadata; scope Matching | 4 orchestration + 1 HTTP tests; 39 tests tổng | `b53f0e8` |
| F09 | Recalculate dùng chung route logic, origin=currentLocation, scope Gateway | 1 HTTP test; 40 tests tổng | `395ac5b` |
| F10 (mock/deploy) | Docker Node 24 pin digest/non-root, local Compose, GitHub workflow, OpenAPI response schemas và docs | Linux mock smoke/restart/SIGTERM; real smoke/benchmark còn chờ endpoint/profile | Xem lịch sử `feat(routing): package and document deployment` |

## Kiểm tra bàn giao

- `npm run test:all`: 42 tests đạt, gồm thêm HTTP disconnect và shutdown khi Realtime lookup chưa vào map queue.
- `npm run test:trip`: 2 cross-service tests đạt; `npm --prefix ../trip-service run test:contract`: 9 Trip contract tests đạt.
- Lint, strict typecheck, build TypeScript và Docker build đạt. Dependencies install/audit báo 0 vulnerabilities tại lần kiểm tra này.
- `npm run smoke:docker`: bốn API mock đạt; 20 estimates đồng thời đạt trong 86 ms ở lần chạy ghi nhận. Đây không phải benchmark OSRM hoặc SLO.
- Linux container restart rồi estimate thành công; SIGTERM stop 806 ms, exit 0. Container thử được xóa; không sửa/xóa Trip containers hoặc volumes. Compose đã validate bằng token test với `config --quiet`.
- Tài liệu được kiểm tra UTF-8, local links và JSON examples. GitHub workflow đã tạo; không đồng nhất checks local với trạng thái workflow remote.

OpenAPI: `/docs` và `/openapi.json`, ngoài production. Dữ liệu estimate đúng hai trường trong data. Runtime hiện có log startup/failure chung; structured operation logs/metrics và production sizing còn cần bổ sung. OSRM real smoke/benchmark và Realtime HTTP adapter chưa hoàn thành do thiếu đầu vào.

Queue đầy trả `ROUTING_BUSY` ngay, nằm trong admission budget; không tạo hàng đợi chờ admission ngoài capacity. Queue age vẫn bị giới hạn riêng. Limiter chạy trong worker, mọi retry cần permit mới.

Shutdown pool ở `beforeApplicationShutdown`, trước khi Nest đóng HTTP adapter; sau grace abort các job còn lại. Body trên 64 KiB trả 413 `INVALID_REQUEST`. OpenAPI `/docs` và `/openapi.json` chỉ bật ngoài production khi cấu hình cho phép.

Matrix dùng deadline chung gồm lookup và mọi batch, không sort/chọn driver và không nhận candidates từ Matching. Empty thành công, dependency lỗi không thành empty; quá cap không cắt danh sách. Runtime chặn `REALTIME_INTEGRATION_MODE=real` nếu chưa có wire adapter đã xác nhận; không tự fallback mock. Số HTTP request đang xử lý cũng bị giới hạn bằng queue size + worker count, bao gồm lookup ngoài map queue.

## Đầu vào tích hợp còn thiếu

- Realtime: method/path, authentication và response thật. Chưa tự đặt contract wire; chỉ triển khai port/mock trước.
- OSRM: endpoint, dataset/version/algorithm và profile xe máy đã kiểm chứng. `BIKE` chưa bật; không thay bằng profile ô tô.
- Một process/replica; cấu hình mặc định chưa được benchmark production.

Các file `.env` và `config/vehicle-profiles.json` local giữ nguyên và được Git ignore. Nghiệp vụ và source Trip Service giữ nguyên.
