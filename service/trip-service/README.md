# Trip Service

Service quản lý nghiệp vụ chuyến đi của Chande, từ báo giá và đặt xe đến nhận chuyến, cập nhật tiến trình, hoàn thành hoặc hủy.

## Tài liệu

| Tài liệu | Nội dung |
| --- | --- |
| [Nghiệp vụ](docs/nghiep-vu.md) | Phạm vi v1, quy tắc đã chốt, vòng đời, user story và tiêu chí nghiệm thu |
| [Kiến trúc](docs/kien-truc.md) | Ranh giới service, lớp/port/adapter, dữ liệu, transaction và outbox |
| [Sơ đồ C4](docs/c4.md) | C1–C4 theo code hiện tại: API/worker, domain, transaction, idempotency và outbox |
| [API](docs/api.md) | Model, request/response, identity, idempotency, lỗi và contract tích hợp |
| [Routes](docs/routes.md) | Bảng route public/internal/outbound, quyền, use case và exposure |
| [Deploy](docs/deploy.md) | Runtime API/worker/DB, cấu hình, migration, phát hành, rollback và monitoring |
| [Báo cáo triển khai](docs/bao-cao-trien-khai.md) | Component, commit, kiểm thử, kết quả Docker và phần cần tích hợp thật |
| [Tích hợp Routing + Price](docs/tich-hop-routing-price.md) | Luồng HTTP ba service, cấu hình local, giá mẫu và kiểm thử tích hợp |

[Mục lục tài liệu dự án](../../docs/README.md).

## Trạng thái phát triển

Đã triển khai C00–C15: domain độc lập, use case, PostgreSQL, REST API có JWT, callback Matching, transactional outbox, worker, OpenAPI và môi trường Docker local. Bộ kiểm thử gồm unit, integration, contract và e2e; xem số liệu và giới hạn trong báo cáo.

Stack đã thống nhất: NestJS, TypeScript, TypeORM và PostgreSQL. Routing, Pricing và Matching được tích hợp qua contract; REST callback và outbox phục vụ luồng bất đồng bộ.

Trip đã gọi API của Routing và Price qua HTTP trong Compose local và kiểm thử ba service. Routing vẫn dùng map provider mock; Price tính từ biểu giá mẫu có thể cấu hình. Matching, Gateway, Notification và JWT issuer local dùng mock. OSRM thật và phát hành lên hosting là bước tiếp theo.

## Chạy local

Từ thư mục `service/trip-service`, với Docker Desktop đang chạy:

```powershell
docker compose -f compose.local.yml up -d --build
docker compose -f compose.local.yml ps
npm.cmd ci
npm.cmd run smoke:local
```

API Trip: <http://localhost:3001>; Routing: <http://localhost:3004>; Price: <http://localhost:3005>; Swagger Trip: <http://localhost:3001/docs>; worker probe: <http://localhost:3002/health/ready>. Stack dùng credential thử, chỉ mở port host trên loopback. Chi tiết nhận JWT local, kiểm thử và chạy source nằm trong [Deploy](docs/deploy.md).

## Kiểm thử

```powershell
docker compose -f compose.test.yml up -d --wait
$env:TEST_DATABASE_URL = 'postgres://trip_test:trip_test@127.0.0.1:55434/trip_test'
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test:all
npm.cmd --prefix ../routing-service ci --ignore-scripts
npm.cmd --prefix ../price-service ci --ignore-scripts
npm.cmd run test:services
npm.cmd run build
```

Tests chỉ nhận DB có tên kết thúc bằng `_test`; dữ liệu trong các bảng Trip của DB đó được làm sạch giữa các ca. Không dùng URL DB local/production cho tests.

## Quy trình

Theo yêu cầu triển khai mới nhất: thực hiện từng feature nhỏ, viết và chạy kiểm thử, commit/push `main` sau khi kiểm thử đạt và bàn giao báo cáo để review. Thay đổi chính sách nghiệp vụ vẫn cần người dùng xác nhận.
