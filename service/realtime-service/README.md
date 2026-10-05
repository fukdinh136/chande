# Realtime Service

Service nhận GPS tài xế và cung cấp danh sách tài xế gần điểm đón cho Routing của Chande.

Ngày đối chiếu mã nguồn: 06/10/2026. V1 có implementation; chưa nghiệm thu trên Redis, Driver/Routing thật hoặc thiết bị.

## Tài liệu

| Tài liệu | Nội dung |
| --- | --- |
| [Nghiệp vụ](docs/nghiep-vu.md) | Hai luồng, quy tắc GPS/eligibility, user story và tiêu chí nghiệm thu |
| [Kiến trúc](docs/kien-truc.md) | C3 theo layer, sequence, port/adapter, Redis và giới hạn nhất quán |
| [API](docs/api.md) | Socket payload/ACK, HTTP nội bộ, batch Driver, validation và lỗi |
| [Routes](docs/routes.md) | Caller, authentication, handler, exposure và outbound |
| [Deploy](docs/deploy.md) | Cấu hình thật, PowerShell, Postman/Socket.IO và chẩn đoán |

Đọc Nghiệp vụ → Kiến trúc → API/Routes → Deploy. [Mục lục chung](../../docs/README.md), [bộ tài liệu Driver](../driver-service/README.md), [tài liệu Trip](../trip-service/README.md) là nguồn đối chiếu.

## Phạm vi v1

1. Driver App gửi vị trí qua Socket.IO khi bật GPS, đã đăng nhập, có xe chọn, ý định ONLINE, màn hình Driver đang focus và app foreground. Chu kỳ mục tiêu 10 giây; hệ điều hành hoặc mạng có thể làm chậm.
2. Routing gọi HTTP nội bộ để tìm nhiều tài xế quanh điểm đón: bán kính mặc định/tối đa 2.000 m, lọc BIKE/CAR_4/CAR_7, tối đa 50 tài xế đủ điều kiện theo snapshot Driver, sắp gần → xa.

Realtime sở hữu GPS và Redis của mình. Driver sở hữu tài khoản, ý định ONLINE/OFFLINE, xe chọn và eligibility; Trip sở hữu chuyến/assignment. Realtime không truy cập PostgreSQL hoặc key Redis riêng của Driver/Trip, không cần Gateway demo. GPS mới không tự đổi ONLINE thành AVAILABLE.

Không triển khai Matching/offer/accept, reservation, chat, push, tuyến đường/ETA hoặc theo dõi chuyến theo tripId. V1 cung cấp nền tảng vị trí; chưa hoàn thành US8 theo dõi chuyến realtime và không có API vị trí cho Rider.

## Công nghệ và cấu trúc

Package hiện khai báo Node.js >=24 <25, NestJS 11, TypeScript ^5.7, Socket.IO ^4.8.4, ioredis ^5.11.1, jose ^6, class-validator/class-transformer và dotenv. Đây là range trong [package.json](package.json), chưa có lockfile Realtime để xác nhận phiên bản cài thực tế. Môi trường local trong Deploy dùng Redis 7.4; app hiện là Expo SDK57. Realtime không có ORM/migration.

```text
service/realtime-service/
  docs/                    # Năm tài liệu liên kết ở trên
  src/
    presentation/          # HTTP và Socket.IO, DTO/guard/filter
    application/           # Use case và port
    domain/                # Location model và policy thuần TypeScript
    infrastructure/        # Redis Lua, Driver HTTP, JWKS, scheduler
    bootstrap/             # Config, module DI, Socket.IO adapter
    main.ts
  scripts/send-location.mjs # Client Socket.IO thủ công
  .env.example
  package.json
  tsconfig.json
```

## Trạng thái triển khai

| Hạng mục | Bằng chứng hiện tại | Trạng thái / giới hạn |
| --- | --- | --- |
| GPS 10 giây | App use-driver-gps.ts, SocketLocationClient; LocationGateway | Có mã foreground và ACK; chưa kiểm thử thiết bị/background |
| Freshness 30 giây | LocationPolicy, Redis Lua, loadConfig | Đã áp dụng; tuổi đạt ngưỡng đã bị loại; cấu hình chỉ cho giảm xuống dưới/tới 30.000 ms |
| Nearby 2 km / 50 | NearbyPolicy, FindNearby, NearbyController | Đã áp dụng trong mã; 50 là hằng số, không phải biến môi trường |
| JWT/JWKS và service credential | JwksTokenVerifier, DriverSocketGuard, RoutingServiceGuard | Có mã kiểm tra; chưa xác minh liên thông với issuer/service thật |
| Eligibility theo lô | DriverEligibilityClient và POST nội bộ Driver | Có hai phía; trạng thái UNKNOWN trả lỗi, không tự coi AVAILABLE |
| Redis ordering/cleanup | RedisLocationRepository, location.scripts.ts | Có Lua nguyên tử đối với request khác; chưa kiểm chứng Redis/multi-process |
| Health | HealthController | Có live và ready; ready chỉ PING Redis |
| Routing consumer / production ingress | Không có implementation trong Realtime | Contract cần bên Routing/Gateway chính thức xác nhận; chưa triển khai ingress/registry credential |
| Operational AVAILABLE/BUSY | Projection do Driver cung cấp | Nguồn đối soát active Trip/freshness còn cần chốt; snapshot có thể cũ, không phải assignment lease |
| Kiểm thử chạy thật | Không có test suite Realtime trong cây hiện tại | Chưa có bằng chứng nghiệm thu runtime; quy trình kiểm tra ở Deploy |

Key Driver legacy drivers:geo:* còn có thao tác cleanup tương thích; Realtime dùng namespace riêng realtime:{gps}:*. Không tự đổi consumer cũ hay dual-write. Chi tiết khác biệt và hợp đồng còn chờ ở [Kiến trúc](docs/kien-truc.md) và [API](docs/api.md).

Hướng dẫn chạy, GPS CLI, Postman, app foreground và tiêu chí kiểm chứng được duy trì tại [Deploy](docs/deploy.md). Chưa có lockfile và dependency riêng được cài; cần xác minh lint/typecheck/build bằng môi trường Realtime riêng trước khi nghiệm thu.
