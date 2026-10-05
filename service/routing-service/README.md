# Routing Service — thiết kế và kế hoạch triển khai

Ngày lập: 06/10/2026. Trạng thái: **tài liệu thiết kế để review và file cấu hình mẫu; chưa có runtime Routing, provider adapter hoặc Docker image chạy được**.

Routing tính tuyến đường, khoảng cách/thời gian và tính lại tuyến. Calculate ETA Matrix nhận điểm đón/profile xe từ Matching, gọi Realtime Client lấy vị trí driver trong bán kính 2 km, tính ETA qua OSRM và trả kết quả theo driverId. Trip sở hữu chuyến/giá đã chốt; lựa chọn/mời tài xế bên trong Matching được thiết kế sau. Thiết kế dựa trên C3 người dùng cung cấp, user story, contract Trip và bổ sung luồng Realtime → ETA do người dùng xác nhận.

## Stack đã chọn

| Phần | Công nghệ thiết kế |
| --- | --- |
| Runtime / ngôn ngữ | Node.js 24, TypeScript 5.9, compiler strict tương tự Trip |
| HTTP API / validation | NestJS 11 + Express, Zod 4, OpenAPI qua NestJS Swagger |
| OSRM client | `fetch`, `AbortController` cho deadline/cancel |
| Realtime client | Adapter riêng trong Routing, lấy driverId/tọa độ/observedAt trong bán kính 2000 m |
| Queue / worker pool | Bounded queue trong RAM, tối đa hai job async đồng thời trong một process |
| Kiểm thử / công cụ | `node:test`, compile trước khi test; npm, ESLint, `tsx` cho development |

Domain/application độc lập với NestJS; OSRM và Realtime chạy riêng. Các package, scripts và runtime thuộc F00–F11 trong kế hoạch, chưa được tạo ở lần cập nhật tài liệu này.

## Tài liệu

| Tài liệu | Nội dung |
| --- | --- |
| [Nghiệp vụ](docs/nghiep-vu.md) | Phạm vi, tác nhân, ba use case, nguồn và điểm cần validate |
| [Kiến trúc và C3](docs/kien-truc.md) | Component, queue/worker/limiter, chiều trả kết quả, deadline và failure handling |
| [API](docs/api.md) | Contract tương thích Trip, route đầy đủ, ETA matrix, recalculate và lỗi |
| [Routes](docs/routes.md) | Đường dẫn, caller, quyền, component và phạm vi exposure |
| [Cấu hình](docs/cau-hinh.md) | Nơi điền API key, mapping loại xe, secrets, giới hạn và validation dự kiến |
| [Realtime Client](docs/realtime-client.md) | ETA Matrix lấy vị trí driver trong bán kính 2 km qua port/client Routing rồi tính ETA cho Matching |
| [Deploy](docs/deploy.md) | Kế hoạch runtime/local/production, lifecycle, probes và tích hợp Trip |
| [Kế hoạch phát triển](docs/ke-hoach-phat-trien.md) | Phase, feature nhỏ, kiểm thử, tiêu chí nghiệm thu và quyết định cần duyệt |

[Mục lục dự án](../../docs/README.md).

## Cấu hình OSRM / điền key nếu endpoint yêu cầu

Đã chuẩn bị file local **`.env`** và **`config/vehicle-profiles.json`**; cả hai được `.gitignore` bảo vệ. Bạn đã chọn OSRM. Cấu hình URL server OSRM của bạn trong `.env`:

```dotenv
EXTERNAL_MAP_PROVIDER=osrm
EXTERNAL_MAP_BASE_URL=
EXTERNAL_MAP_AUTH_MODE=none
EXTERNAL_MAP_API_KEY=
```

OSRM gốc không định nghĩa bước xác thực API key trong [HTTP API](https://project-osrm.org/docs/v5.24.0/api/). Nếu dùng proxy/hosting có key riêng, điền `EXTERNAL_MAP_API_KEY`, chọn `EXTERNAL_MAP_AUTH_MODE=header` và tên header theo contract proxy. Hiện chưa có request gửi đến OSRM; chỉ chuyển `INTEGRATION_MODE=real` sau khi triển khai adapter, cấu hình endpoint/profile và kiểm thử theo [Cấu hình](docs/cau-hinh.md).

Trong checkout mới, nếu chưa có các file local, sao chép từ mẫu; không ghi đè file đã có key:

```powershell
if (!(Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
if (!(Test-Path -LiteralPath 'config/vehicle-profiles.json')) { Copy-Item -LiteralPath 'config/vehicle-profiles.example.json' -Destination 'config/vehicle-profiles.json' }
```

## Quyết định hiện tại

- Giữ nguyên `POST /internal/routes/estimate` mà Trip đã triển khai. Response summary không thêm polyline/steps vào `data`.
- C3 nối Calculate ETA Matrix → RealtimeLocationPort → Realtime Client để lấy origins trong 2 km, rồi dispatcher → queue → worker pool → limiter → OSRM Table. Matching gửi pickup/profile, nhận vị trí/observedAt/ETA theo driverId; nghiệp vụ chọn/mời thiết kế sau.
- Stack được chọn là Node.js 24 + TypeScript 5.9 + NestJS 11, đồng bộ với Trip. Phase 1 dùng bounded queue trong một process/một replica; API chờ Promise kết quả đến deadline và trả HTTP 200 hoặc lỗi. Mặc định hai async workers và deadline 4 giây.
- Provider đã chốt **OSRM**. URL server, dữ liệu vùng, profile xe máy, giới hạn tải và hosting còn cần review. Mẫu dùng `osrm`/`mock`, URL và key trống; chưa chọn public demo hay tải dữ liệu bản đồ.
- Triển khai runtime sau khi review kế hoạch; mỗi feature có kiểm thử riêng và commit nhỏ.
