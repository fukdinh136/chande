# Matching Service

| Thuộc tính | Giá trị |
| --- | --- |
| Service | matching-service |
| Rà soát | 2026-11-16 |
| Quy ước | [Format và số liệu](../../docs/quy-uoc-tai-lieu.md) |

Matching v1 mời tuần tự một tài xế trong bán kính 2 km, theo ETA driver → pickup. Matching tự tìm ứng viên ([ADR-0001](../../docs/adr/0001-matching-so-huu-tim-ung-vien.md)): lấy vị trí từ Realtime, kiểm điều kiện theo lô ở Driver, tính ETA ở Routing; Matching sở hữu search, offer, reservation và quyết định nhận chuyến. Offer có hạn 20 giây; search không có hạn tự hủy ([ADR-0004](../../docs/adr/0004-gioi-han-thoi-gian-tim-xe.md) còn ở trạng thái đề xuất).

Cải tiến hiệu năng và chịu lỗi trên nhánh `perf/adr-0008-trip-outbox`: [báo cáo triển khai, mục cải tiến](docs/bao-cao-trien-khai.md#cải-tiến-hiệu-năng-và-chịu-lỗi).

Stack: Node.js 24, TypeScript 5.9, NestJS 11, Zod 4, TypeORM/PostgreSQL, RabbitMQ/amqplib. Domain/application không phụ thuộc NestJS.

Tài liệu: [nghiệp vụ](docs/nghiep-vu.md), [kiến trúc/C3](docs/kien-truc.md), [API/routes](docs/api.md), [deploy](docs/deploy.md), [kế hoạch](docs/ke-hoach-phat-trien.md), [báo cáo](docs/bao-cao-trien-khai.md).
