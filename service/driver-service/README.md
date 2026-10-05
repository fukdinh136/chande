# Driver Service

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

Có mã cho OTP local/provider adapter, JWT RS256/JWKS, refresh rotation, hồ sơ/xe, selection Redis, ONLINE/OFFLINE PostgreSQL, reconcile và batch eligibility Realtime. Domain/Application độc lập NestJS, TypeORM, Redis và HTTP.

Các repository PostgreSQL và adapter Redis/Trip là adapter thật. OTP mock chỉ dùng local, lưu challenge/rate limit trong bộ nhớ và mất khi restart; production từ chối mock. HTTP OTP provider có contract riêng cần xác nhận. Không có Trip/Matching mock service trong backend Driver.

Chưa có DDL Driver có thẩm quyền trong repository; mapping không thay thế DDL. Integration PostgreSQL/Redis, liên thông Trip/issuer thật, nhiều instance và app trên thiết bị cần kiểm chứng ở môi trường riêng. Test HTTP dùng port bộ nhớ không chứng minh những tích hợp đó. Realtime còn cần nguồn đối soát AVAILABLE/BUSY với Trip; ONLINE không tự bảo đảm nhận được cuốc. Matching/offer và thông báo chuyến realtime chưa được nối trong app.

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
