# Realtime Service

Service nhận GPS tài xế và cung cấp danh sách tài xế gần điểm đón cho Routing của Chande.

Ngày đối chiếu mã nguồn: 06/10/2026. GPS/nearby/offer đã chạy với Redis, Driver/Routing/Matching thật trong Docker local Hà Nội. Thiết bị/background, ingress production và nhiều replica chưa nghiệm thu.

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

Matching sở hữu search/offer/accept/reservation. Realtime đã bổ sung RabbitMQ consumer để giao offer/cập nhật qua Socket.IO, room từ JWT và replay trạng thái khi reconnect. Chat, push và theo dõi vị trí cho Rider chưa thuộc triển khai này. Xem [Matching](../matching-service/README.md).

## Công nghệ và cấu trúc

Package khai báo Node.js >=24 <25, NestJS 11, TypeScript ^5.7, Socket.IO ^4.8.4, ioredis ^5.11.1, jose ^6, amqplib, Zod, class-validator/class-transformer và dotenv; phiên bản khóa trong package-lock.json. Stack Matching local dùng Redis 8. Realtime không có ORM/migration.

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
| JWT/JWKS và service credential | JwksTokenVerifier, DriverSocketGuard, RoutingServiceGuard | Đã liên thông JWT Driver và credential Routing trong smoke Docker |
| Eligibility theo lô | DriverEligibilityClient và POST nội bộ Driver | Có hai phía; trạng thái UNKNOWN trả lỗi, không tự coi AVAILABLE |
| Redis ordering/cleanup | RedisLocationRepository, location.scripts.ts | Redis thật chạy trong smoke; multi-replica chưa nghiệm thu |
| Health | HealthController | Có live và ready; ready chỉ PING Redis |
| Routing client / production ingress | Routing có HTTP Realtime adapter | Nearby/matrix đã chạy thật; ingress production chưa nghiệm thu |
| Operational AVAILABLE/BUSY | Driver đối soát active Trip và reservation Matching | BUSY/AVAILABLE đã kiểm tra trong smoke; snapshot không thay thế reservation DB |
| Offer delivery/reconnect | Rabbit consumer, Redis version/tombstone, Matching lookup | 2 consumer tests và smoke WebSocket/reconnect pass; không reset deadline |

Key Driver legacy drivers:geo:* còn có thao tác cleanup tương thích; Realtime dùng namespace riêng realtime:{gps}:*. Không tự đổi consumer cũ hay dual-write. Chi tiết khác biệt và hợp đồng còn chờ ở [Kiến trúc](docs/kien-truc.md) và [API](docs/api.md).

Hướng dẫn GPS CLI/Postman/app foreground ở [Deploy](docs/deploy.md). Stack offer, startup/shutdown và requeue ở [runbook Matching](../matching-service/docs/deploy.md); bằng chứng thực chạy ở [báo cáo Matching](../matching-service/docs/bao-cao-trien-khai.md). Lockfile, build/lint và consumer tests đã được kiểm tra trong môi trường Realtime riêng.
