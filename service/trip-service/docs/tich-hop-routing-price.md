# Báo cáo tích hợp Trip → Routing → Price

Ngày 06/10/2026. Tích hợp API của hai service trong repository bằng HTTP. Trip giữ riêng domain, database, quote và vòng đời chuyến; Routing và Price chạy process riêng.

## Kết quả và phạm vi

Routing đã có API tương thích RoutingClient của Trip. Price trước đợt này chỉ có thiết kế/config, nên bổ sung runtime Node.js 24 + TypeScript 5.9 + NestJS 11/Zod 4, kiểm thử, Docker và CI. Không thay đổi chính sách active, quote 5 phút, hủy hoặc Matching bất đồng bộ của Trip.

```mermaid
sequenceDiagram
    participant C as Khách
    participant T as Trip API
    participant R as Routing API
    participant P as Price API
    participant D as Trip PostgreSQL
    C->>T: POST /trips/estimate (JWT)
    T->>R: POST /internal/routes/estimate
    R-->>T: distanceMeters, durationSeconds
    T->>P: POST /internal/fares/estimate (route, vehicleType)
    P-->>T: currency, amount, breakdown
    T->>D: Lưu quote sau khi hai dependency thành công
    T-->>C: Quote thuộc khách, hạn 5 phút
    C->>T: POST /trips (quoteId, Idempotency-Key)
    T->>D: Tạo SEARCHING và ghi outbox trong transaction
```

Estimate không tạo chuyến, không gọi Matching. Create sử dụng quote đã lưu, không tính lại giá. Khi hoàn thành, final fare bằng estimated fare đã chốt. Hai lời gọi outbound giữ cùng request ID và dùng token riêng từng đích. Khi dependency lỗi, Trip trả 503 `DEPENDENCY_UNAVAILABLE`, không lưu quote một phần; Routing lỗi thì không gọi Price.

## Contract và cấu hình

| Đích | Endpoint | Request | Data trả về |
| --- | --- | --- | --- |
| Routing | `POST /internal/routes/estimate` | `{pickup,destination,vehicleType}` | Đúng hai trường `distanceMeters`, `durationSeconds` |
| Price | `POST /internal/fares/estimate` | `{route:{distanceMeters,durationSeconds},vehicleType}` | `{currency:"VND",amount,breakdown}`; tiền dạng chuỗi |

Cả hai dùng envelope `{data,meta:{requestId}}`, `X-Service-Token` và `X-Request-Id`. Trip kiểm tra strict contract, cap tiền và tổng breakdown. Chi tiết: [Routing API](../../routing-service/docs/api.md), [Price API](../../price-service/docs/api.md).

| Biến Trip | Trong Compose local | Khi Trip chạy source trên host |
| --- | --- | --- |
| `ROUTING_BASE_URL` | `http://routing-api:3004` | `http://127.0.0.1:3004` |
| `PRICING_BASE_URL` | `http://price-api:3005` | `http://127.0.0.1:3005` |
| `ROUTING_TOKEN` | Khớp `ROUTING_TRIP_TOKEN` | Khớp token của Routing đang chạy |
| `PRICING_TOKEN` | Khớp `PRICE_TRIP_TOKEN` | Khớp token của Price đang chạy |

Các `.env`/profile local hiện có không bị ghi đè. Nếu chạy source với `.env` cũ, cập nhật hai URL/token và enabled vehicle types theo bảng. Compose dùng credential thử inline; production dùng credential riêng hoặc mounted secret và endpoint private đã xác nhận.

Giá mẫu có thể sửa trong policy file: CAR mở cửa 12.000đ bao gồm 1.000 m, vượt tính 10.000đ/km; BIKE 8.000đ và 4.000đ/km. Price tính phần vượt theo mét, làm tròn lên 1 VND bằng BigInt. `durationSeconds` được nhận để tương thích Trip; chưa có phụ phí thời gian. Đây là mức mẫu được người dùng cho phép đặt, chưa phải biểu giá kinh doanh.

`fare-policy.example.json` giữ CAR/BIKE; `fare-policy.mock.json` khai báo thêm MOCK_BIKE explicit. Policy được validate và tạo snapshot khi startup; sửa config rồi restart để áp dụng cho estimate mới, quote cũ không đổi. Routing dùng `vehicle-profiles.mock.json` riêng cho ba mã xe; không thay file cấu hình OSRM local.

## Kiểm thử và vận hành đã thực hiện

| Kiểm tra | Kết quả |
| --- | --- |
| Price `npm run test:all` | 6 tests đạt: mở cửa/ranh giới/phần vượt, BigInt/làm tròn/overflow, snapshot/config, auth, DTO, correlation, body limit, probes và OpenAPI |
| Routing `npm run test:all` | 42 tests đạt: OSRM wire mapping, HTTP/scopes, queue/pool/limiter/deadline, Realtime/matrix/recalculate và shutdown |
| Trip `npm run test:all` | 88 tests đạt, gồm unit, contract, integration PostgreSQL và HTTP e2e |
| Trip `npm run test:services` | 2 tests đạt qua HTTP ba API và PostgreSQL test; CAR 42.000đ, BIKE 20.000đ cho 4 km/600 giây; correlation, quote TTL, create replay, assignment/completion giữ giá; Routing lỗi/timeout, sai token Price không lưu quote |
| Lint/typecheck/build | Price và Trip đạt; Routing compile thành công trong cross-service build |
| Docker Compose build và startup | Ba image build thành công; API/worker/DB/mock/Routing/Price healthy, migration exit 0 |
| `npm run smoke:local` | Tạo → nhận → đến → bắt đầu → hoàn thành, và chuyến riêng hủy thành công; smoke đối chiếu giá quote thay vì hard-code 45.000đ |

Tests dữ liệu dùng DB riêng `trip_test`, chỉ chấp nhận tên database kết thúc `_test`. Docker smoke tạo hai chuyến fixture UUID mới trong local, kết thúc hoàn thành/hủy. Không xóa volume local. CI Trip chạy cross-service khi Trip/Routing/Price thay đổi; Price có workflow lint/typecheck/tests/build/audit/Docker riêng. Kết quả trên là checks local, chưa phải kết quả workflow GitHub.

Từ `service/trip-service`:

```powershell
docker compose -f compose.local.yml up -d --build --wait
npm.cmd run smoke:local
# Kiểm thử cần npm ci ở cả ba package và PostgreSQL test:
docker compose -f compose.test.yml up -d --wait
$env:TEST_DATABASE_URL = 'postgres://trip_test:trip_test@127.0.0.1:55434/trip_test'
npm.cmd run test:all
npm.cmd run test:services
```

Local: Trip 3001, worker probe 3002, mock 3003, Routing 3004, Price 3005, PostgreSQL dev 55433; chỉ publish host loopback. Trip Compose đợi Routing/Price healthy trước API startup. Stack được giữ chạy để review; [deploy runbook](deploy.md) có hướng dẫn chạy source và dừng stack.

## Giới hạn còn lại

- Routing API/queue/limiter chạy thật, nhưng map provider vẫn mock (4 km, 600 giây). OSRM adapter đã có; cần endpoint/dataset và profile BIKE đã kiểm chứng để tích hợp real.
- Realtime matrix HTTP adapter chưa có contract wire xác nhận; phần này không nằm trong luồng quote và không được đánh dấu hoàn tất.
- Matching, Gateway, Notification và JWT issuer local vẫn mock; không merge User/Driver/Gateway trong đợt này.
- Chưa deploy hosting, chưa benchmark production hoặc xác nhận biểu giá kinh doanh.

## Feature bàn giao

1. `87eb5c2` — `feat(price): expose configurable fare estimate API`: runtime/config/tests/Docker/CI Price.
2. `feat(trip): integrate Routing and Price service APIs`: wiring Compose/env example, mock vehicle profile riêng, cross-service tests, smoke/CI và tài liệu.

Commit được thực hiện sau khi checks đạt, theo ủy quyền commit/push từng feature. Xem lịch sử Git để lấy SHA của hai feature.
