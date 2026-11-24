# Routes Routing Service

| Thuộc tính | Giá trị |
| --- | --- |
| Service | routing-service |
| Rà soát | 2026-10-06 |
| Quy ước | [Format và số liệu](../../../docs/quy-uoc-tai-lieu.md) |

Ngày cập nhật: 06/10/2026. Bảng route đã triển khai. Request/response và lỗi: [API](api.md). Từ 2026-11-05 R03 và outbound Realtime đã bị gỡ theo [ADR-0001](../../../docs/adr/0001-matching-so-huu-tim-ung-vien.md).

## Inbound

| Mã | Method / route tại Routing | Caller được phép đề xuất | Component | Contract |
| --- | --- | --- | --- | --- |
| R01 | POST `/internal/routes/estimate` | Trip | Calculate Route, summary view | Đã có Trip client/test; giữ strict RouteSummary |
| R02 | POST `/routes` | Gateway | Calculate Route, full view | Polyline6/steps; Trip hiện không có scope này |
| R05 | POST `/internal/routes/eta-matrix` | Matching | Calculate ETA For Origins | Matching gửi tối đa 50 điểm đã chọn → OSRM tính N→1 ETA; không gọi Realtime ([ADR-0001](../../../docs/adr/0001-matching-so-huu-tim-ung-vien.md)) |
| R04 | POST `/routes/recalculate` | Gateway | Recalculate Route | Current location → destination |
| H01 | GET `/health/live` | Runtime probe | Process liveness | Không gọi Map API |
| H02 | GET `/health/ready` | Runtime probe | Config + pool/admission readiness | Không gọi Map API có tính phí |
| D01 | GET `/docs` | Developer local | OpenAPI UI | Bật local; production mặc định tắt |
| D02 | GET `/openapi.json` | Developer/contract CI | OpenAPI schema | Cùng exposure D01 |

Trong production, cả R01, R02, R04, R05 là backend/private API và cần service token, kể cả đường dẫn `/routes` không có prefix internal. Gateway có thể proxy R02/R04 thành `/api/v1/routes` và `/api/v1/routes/recalculate` sau JWT/permission/rate checks; đó là đề xuất Gateway, chưa có route public triển khai. Không proxy eta-matrix, probes, docs hoặc estimate nội bộ ra public.

Gateway token không có quyền gọi eta-matrix; Matching token không dùng để gọi Trip estimate; Trip token không có quyền reroute qua R04 theo scope v1 đề xuất. Nếu Gateway cần estimate cho preview, phải thêm scope rõ ràng hoặc gọi Trip estimate để lấy cả giá; không tái sử dụng token Trip tùy tiện.

## Outbound

| Operation | Caller bên trong Routing | Endpoint external |
| --- | --- | --- |
| Route hoặc recalculate | Worker → rate permit → External Map Client | OSRM GET `/route/v1/{profile}/{coordinates}` với summary/full options |
| ETA matrix | Worker → rate permit request + elements → External Map Client | OSRM GET `/table/v1/{profile}/{coordinates}`; N sources, 1 destination; duration/distance |

Không thêm endpoint tự do để caller gửi URL provider hoặc API key. Base URL/default và override theo profile thuộc config tin cậy, kiểm tra host allowlist; không theo redirect. HTTPS mặc định, private HTTP opt-in; proxy key chỉ qua HTTPS. Không log URL/raw coordinates/key. Xem [wire mapping](api.md) và [cấu hình](cau-hinh.md).

Routing không có outbound tới Realtime: Matching gửi sẵn origins cho R05.

## Ngoài v1

Chưa có `/jobs`, job polling/callback, gRPC, geocoding, autocomplete, tiles, GPS stream, route history hoặc API đổi giá/chuyến. Queue nội bộ không tạo contract durable job ở HTTP.
