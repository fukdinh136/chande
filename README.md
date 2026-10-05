# Chande — hệ thống đặt xe

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Toàn hệ thống |
| Rà soát | 2026-10-06 |
| Quy ước | [Format và số liệu](docs/quy-uoc-tai-lieu.md) |

Tám service backend trong `service/`; ứng dụng Expo trong `app/`. [Mục lục tài liệu](docs/README.md), [hợp đồng/số liệu chung](docs/hop-dong-lien-service.md) và [báo cáo validation](docs/bao-cao-validation.md).

| Service | Vai trò | Tài liệu |
| --- | --- | --- |
| API Gateway | JWT, proxy REST và WebSocket trip events | [README](service/api-gateway/README.md) |
| User | Auth/hồ sơ/địa chỉ khách, Java 21 | [README](service/user-service/README.md) |
| Driver | Auth/hồ sơ/xe, intent và availability | [README](service/driver-service/README.md) |
| Trip | Quote/vòng đời chuyến, assignment và outbox | [README](service/trip-service/README.md) |
| Routing | OSRM route/ETA matrix, lookup GPS Realtime | [README](service/routing-service/README.md) |
| Price | Giá mở cửa/quãng đường theo policy | [README](service/price-service/README.md) |
| Matching | Offer tuần tự, reservation, accept/decline | [README](service/matching-service/README.md) |
| Realtime | GPS/nearby và Rabbit offer → Socket.IO | [README](service/realtime-service/README.md) |

Kiểm tra tài liệu: `node scripts/validate-docs.cjs`. Backend mới đã deploy Docker/Kubernetes local và smoke qua Gateway/User thật: [runbook](docs/deploy-backend.md), [báo cáo](docs/bao-cao-tich-hop-backend.md). Docker ingress http://127.0.0.1:18080; Kubernetes http://127.0.0.1:18081 qua port-forward. Stack Matching cũ vẫn có [runbook riêng](service/matching-service/docs/deploy.md) và mock RIDER/Gateway; không nhầm kết quả hai stack.
