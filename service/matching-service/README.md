# Matching Service

| Thuộc tính | Giá trị |
| --- | --- |
| Service | matching-service |
| Rà soát | 2026-10-06 |
| Quy ước | [Format và số liệu](../../docs/quy-uoc-tai-lieu.md) |

Matching v1 mời tuần tự một tài xế trong bán kính 2 km, theo ETA driver → pickup. Routing sở hữu truy vấn GPS; Matching sở hữu search, offer, reservation và quyết định nhận chuyến. Offer có hạn 20 giây; search không có hạn tự hủy.

Stack: Node.js 24, TypeScript 5.9, NestJS 11, Zod 4, TypeORM/PostgreSQL, RabbitMQ/amqplib. Domain/application không phụ thuộc NestJS.

Tài liệu: [nghiệp vụ](docs/nghiep-vu.md), [kiến trúc/C3](docs/kien-truc.md), [API/routes](docs/api.md), [deploy](docs/deploy.md), [kế hoạch](docs/ke-hoach-phat-trien.md), [báo cáo](docs/bao-cao-trien-khai.md).
