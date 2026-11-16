# Driver Service

| Thuộc tính | Giá trị |
| --- | --- |
| Service | driver-service |
| Rà soát | 2026-11-16 |
| Quy ước | [Format và số liệu](../../docs/quy-uoc-tai-lieu.md) |

Backend Driver của Chande: đăng nhập OTP cho tài xế đã tồn tại, phiên JWT/refresh, hồ sơ, phương tiện, chọn xe, ý định nhận cuốc và eligibility cho các service nội bộ.

Backend chính thức nằm tại `service/driver-service/`. Frontend Driver trong [app/src/features/driver](../../app/src/features/driver/). Driver gọi Trip trực tiếp; GPS đi qua [Realtime Service](../realtime-service/README.md). Không cần Gateway demo.

## Tài liệu

| Tài liệu | Nội dung |
| --- | --- |
| [Nghiệp vụ](docs/nghiep-vu.md) | Quy tắc hiện tại, phạm vi và giới hạn |
| [Kiến trúc](docs/kien-truc.md) | C3, layer, port/adapter và nhất quán |
| [API](docs/api.md) | Payload, envelope, lỗi và contract nội bộ |
| [Routes](docs/routes.md) | Route, caller, guard và handler |
| [Deploy](docs/deploy.md) | Cấu hình, chạy trực tiếp, app và kiểm tra |

Nguồn đối chiếu: [tài liệu chung](../../docs/README.md), [Trip](../trip-service/README.md), [Realtime](../realtime-service/README.md).

## Trạng thái triển khai

Có mã cho OTP local/provider adapter, JWT RS256/JWKS, refresh rotation, hồ sơ/xe, selection Redis, ONLINE/OFFLINE PostgreSQL, reconcile và eligibility theo lô cho Matching. Domain/Application độc lập NestJS, TypeORM, Redis và HTTP.

Các repository PostgreSQL và adapter Redis/Trip là adapter thật. OTP mock chỉ dùng local, lưu challenge/rate limit trong bộ nhớ và mất khi restart; production từ chối mock. HTTP OTP provider có contract riêng cần xác nhận. Không có Trip/Matching mock service trong backend Driver.

DDL Driver có thẩm quyền production chưa nằm trong repository; mapping/fixture không thay DDL. PostgreSQL/Redis tests chạy trên fixture cô lập; Driver issuer/Trip/availability đã liên thông smoke Matching Hà Nội. Occupancy đối soát active Trip/reservation để project AVAILABLE/BUSY; ONLINE không tự bảo đảm nhận cuốc. Nhiều replica, production và app offer UI/thiết bị chưa nghiệm thu. [Báo cáo validation](../../docs/bao-cao-validation.md).

### Cải tiến hiệu năng và chịu lỗi

Làm trên nhánh `perf/adr-0008-trip-outbox`; tổng quan ở [tổng hợp cải tiến hiệu năng](../../docs/tong-hop-cai-tien-hieu-nang.md).

| Cải tiến | Thay đổi trong Driver | Commit |
| --- | --- | --- |
| A4 | Giới hạn OTP theo IP thật do Gateway chuyển kèm credential `GATEWAY_PROXY_TOKEN` | `7a0eec9` |
| B7 | Kiểm điều kiện cả lô bằng số lượt truy cập cố định, không khoá ở đường chỉ đọc | `3cb0d8a` |
| [ADR-0001](../../docs/adr/0001-matching-so-huu-tim-ung-vien.md) | Thêm `eligibility/candidates` cho Matching; gỡ `eligibility/batch` cho Realtime | `50f4f17`, `fe97068` |
| B6, [ADR-0003](../../docs/adr/0003-observability-opentelemetry.md) | OpenTelemetry tuỳ chọn | `7ae5bd2` |
| D1 | Circuit breaker cho client Trip và Matching | `b0b21b4` |

## Cấu trúc

```text
service/driver-service/
  docs/
  src/
    presentation/http/{controllers,dto,guards,filters}/
    application/{ports,use-cases}/
      use-cases/{auth,profile,vehicle,availability,eligibility}/
    domain/{driver,vehicle,policies,value-objects}/
    infrastructure/
      persistence/{entities,repositories,mappers,unit-of-work}/
      auth/
      otp/
      redis/
      clients/
    bootstrap/{config,modules}/
    main.ts
  scripts/{check-architecture,check-schema}.cjs
  test/{unit,contract,integration,e2e,helpers}/
  .env.example
  driver-direct.env.example
  Dockerfile
  package.json
  package-lock.json
```

## Chạy nhanh

Từ root repository, sau khi có PostgreSQL Driver/schema/tài khoản test được cấp, Redis Driver và Trip với trust JWT tương thích:

```powershell
Set-Location service/driver-service
npm.cmd ci
```

```powershell
if (-not (Test-Path -LiteralPath '.env')) {
  Copy-Item -LiteralPath '.env.example' -Destination '.env'
}
```

Điền URL/credential riêng, mã OTP local sáu chữ số, issuer/audience và Trip URL trong `.env`. Sample có placeholder, chưa chạy được ngay. Không ghi secret vào source hoặc biến `EXPO_PUBLIC_*`.

```powershell
npm.cmd run start:dev
```

Mặc định HTTP port 3003, không prefix `/api/v1`; JWKS tại `/.well-known/jwks.json`. `start:dev` dùng ts-node, không watch. Hướng dẫn đầy đủ, app, integration target và chẩn đoán ở [Deploy](docs/deploy.md).

TypeORM luôn `synchronize:false`, `migrationsRun:false`, `installExtensions:false`. Driver không tạo schema, seed dữ liệu hay truy cập database Trip.
