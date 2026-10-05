# Routes Routing Service

Ngày lập: 06/10/2026. Đây là bảng route thiết kế; runtime Routing chưa triển khai. Request/response và lỗi: [API](api.md).

## Inbound

| Mã | Method / route tại Routing | Caller được phép đề xuất | Component | Contract |
| --- | --- | --- | --- | --- |
| R01 | POST `/internal/routes/estimate` | Trip | Calculate Route, summary view | Đã có Trip client/test; giữ strict RouteSummary |
| R02 | POST `/routes` | Gateway, Trip nếu scope được duyệt | Calculate Route, full view | Đề xuất polyline/steps |
| R03 | POST `/routes/matrix` | Matching | Calculate ETA Matrix | Pickup/profile → Realtime lấy driver trong 2 km → OSRM tính N→1 ETA |
| R04 | POST `/routes/recalculate` | Gateway | Recalculate Route | Đề xuất current location → destination |
| H01 | GET `/health/live` | Runtime probe | Process liveness | Không gọi Map API |
| H02 | GET `/health/ready` | Runtime probe | Config + pool/admission readiness | Không gọi Map API có tính phí |
| D01 | GET `/docs` | Developer local | OpenAPI UI | Bật local; production mặc định tắt |
| D02 | GET `/openapi.json` | Developer/contract CI | OpenAPI schema | Cùng exposure D01 |

Trong production, cả R01–R04 là backend/private API và cần service token, kể cả đường dẫn `/routes` không có prefix internal. Gateway có thể proxy R02/R04 thành `/api/v1/routes` và `/api/v1/routes/recalculate` sau JWT/permission/rate checks; đó là đề xuất Gateway, chưa có route public triển khai. Không proxy matrix, probes, docs hoặc estimate nội bộ ra public.

Gateway token không có quyền gọi matrix; Matching token không dùng để gọi Trip estimate; Trip token không có quyền reroute qua R04 theo scope v1 đề xuất. Nếu Gateway cần estimate cho preview, phải thêm scope rõ ràng hoặc gọi Trip estimate để lấy cả giá; không tái sử dụng token Trip tùy tiện.

## Outbound

| Operation | Caller bên trong Routing | Endpoint external |
| --- | --- | --- |
| Route hoặc recalculate | Worker → rate permit → External Map Client | OSRM GET `/route/v1/{profile}/{coordinates}` với summary/full options |
| ETA matrix | Worker → rate permit request + elements → External Map Client | OSRM GET `/table/v1/{profile}/{coordinates}`; N sources, 1 destination; duration/distance |
| Nearby driver locations cho ETA Matrix | Calculate ETA Matrix → RealtimeLocationPort → Realtime Client trong Routing | Realtime query center=pickup/radius 2000 m; method/path/auth chốt theo wire contract Realtime |

Không thêm endpoint tự do để caller gửi URL provider hoặc API key. Base URL/default và override theo profile thuộc config tin cậy, kiểm tra host allowlist; không theo redirect. HTTPS mặc định, private HTTP opt-in; proxy key chỉ qua HTTPS. Không log URL/raw coordinates/key. Xem [wire mapping](api.md) và [cấu hình](cau-hinh.md).

Realtime Client lấy cấu hình/credential riêng; R03 gọi client trước map pipeline. Matching gửi điểm đón/profile và nhận driver locations + ETA; nghiệp vụ chọn/mời bên trong Matching thiết kế sau. Giữ `/routes/matrix`; không thêm nearby endpoint. Contract component: [Realtime Client](realtime-client.md).

## Ngoài v1

Chưa có `/jobs`, job polling/callback, gRPC, geocoding, autocomplete, tiles, GPS stream, route history hoặc API đổi giá/chuyến. Queue nội bộ không tạo contract durable job ở HTTP.
