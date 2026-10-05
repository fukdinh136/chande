# Báo cáo triển khai Trip Service v1

| Thuộc tính | Giá trị |
| --- | --- |
| Service | trip-service |
| Rà soát | 2026-10-06 |
| Quy ước | [Format và số liệu](../../../docs/quy-uoc-tai-lieu.md) |

Ngày bàn giao: 05/10/2026. Cơ sở: tài liệu nghiệp vụ, kiến trúc, API, routes và kế hoạch C00–C15; yêu cầu mới nhất cho phép triển khai liên tục, kiểm thử và push từng feature nhỏ.

Cập nhật 06/10/2026: [tích hợp API Routing + Price](tich-hop-routing-price.md) đã triển khai và kiểm thử. Các kết quả dưới đây ghi nhận đợt Trip C00–C15 ban đầu; báo cáo mới mô tả thay đổi runtime, Compose và checks ba service.

## 1. Kết quả

Đã triển khai backend riêng tại `service/trip-service` với NestJS/TypeScript, TypeORM/PostgreSQL, REST callback và transactional outbox. Domain/application độc lập với framework. API, worker, migration job, bộ mock, OpenAPI và Docker local chạy được; 88/88 kiểm thử đạt trên PostgreSQL thật. Từng feature được commit và push lên `origin/main` của [chande](https://github.com/fukdinh136/chande).

Không thay đổi code app Expo trong đợt triển khai Trip. Không triển khai thuật toán Routing/Pricing/Matching, User/Driver, Gateway hoặc Notification thật; các service ngoài được mô phỏng theo contract để kiểm chứng Trip.

Quy tắc giữ nguyên:

- Một chuyến active cho mỗi khách và tài xế, được unique index bảo vệ khi có request đồng thời.
- Quote giữ giá đúng 5 phút, đúng khách, dùng một lần; hành trình/loại xe/giá được snapshot khi tạo chuyến.
- Matching bất đồng bộ; chỉ gán sau callback nhận chuyến hợp lệ. SEARCHING không có deadline và không tự hủy vì chưa tìm được xe.
- Khách và tài xế được gán chỉ hủy trước IN_PROGRESS; không phí, tài xế hủy không tìm lại.
- Giá cuối khi COMPLETED bằng giá đã chốt; tiền VND là chuỗi số nguyên, kiểm tra chính xác bằng BigInt.
- COMPLETED/CANCELLED không mở lại. Request/callback lặp trả snapshot/ACK cũ và không ghi thêm history/event.

## 2. Component đã triển khai

| Mốc | Component | Kết quả và kiểm chứng |
| --- | --- | --- |
| C00 | Nền tảng/contract | Package/lockfile, TypeScript strict, config theo process, secret file, test runner, mock và CI |
| C01 | State machine | Ma trận trạng thái/hành động, từ chối bỏ bước và mở lại terminal; kiểm thử cả 42 tổ hợp |
| C02 | Trip Domain | Snapshot bất biến, quyền, version, quote, timestamp, hủy và giá cuối |
| C03 | Persistence | Transaction PostgreSQL, active indexes, CAS version, quotes, history, receipts, inbox, outbox; kiểm thử rollback/race và role |
| C04 | Routing Client | HTTP có timeout, credential/request ID và schema validation |
| C05 | Pricing Client | Kiểm tra VND/string money/BIGINT/breakdown; không tự tính công thức giá |
| C06 | Estimate | Routing → Pricing → lưu quote; TTL bắt đầu sau khi dependency hoàn tất |
| C07 | Matching Client | Command tìm/hủy bất đồng bộ, giữ ID khi retry, xác minh ACK 202 đúng ID |
| C08 | Dispatcher | Delivery theo từng đích, SKIP LOCKED, renewable lease, backoff, blocked/requeue, bỏ search muộn, recovery sau restart |
| C09 | Create | Quote + Trip SEARCHING + history + receipt + outbox commit nguyên tử |
| C10 | Receive Assignment | Inbox chống lặp, khóa Trip, kiểm tra loại xe/tài xế active; hai tài xế không cùng thắng |
| C11 | Get | Chi tiết, active của mình, terminal history, cursor HMAC theo actor/filter, route tĩnh và quyền đọc |
| C12 | Update | DRIVER_ARRIVED → IN_PROGRESS → COMPLETED, đúng tài xế/version, idempotency và giá cố định |
| C13 | Cancel | Hủy nguyên tử, version/race, command dừng Matching, không phí hoặc rematching |
| C14 | API/Auth | R01–R08, Zod strict, JWT/JWKS, callback credential riêng, error envelope, request ID và OpenAPI |
| C15 | Toàn luồng | HTTP/JWT ký thật/DB/dispatcher, smoke Docker, CI workflow và báo cáo |

“Đã triển khai” là kết quả code và kiểm thử local/contract; chưa thay cho việc người dùng nghiệm thu hoặc tích hợp các service thật.

## 3. Kiểm thử và kiểm tra

| Nhóm | Số kiểm thử | Kết quả |
| --- | ---: | --- |
| Unit | 55 | Đạt |
| Integration PostgreSQL | 20 | Đạt |
| Contract HTTP/mock | 9 | Đạt |
| E2E HTTP/JWT | 4 | Đạt |
| Tổng | **88** | **88 đạt, 0 lỗi, 0 bỏ qua** |

Các tình huống chính đã được chứng minh:

- Request create trùng đồng thời chỉ có một tác dụng; key cũ với nội dung khác bị từ chối.
- Quote hết hạn/đã dùng/sai chủ; replay create thành công vẫn được trả sau khi quote hết hạn.
- Một tài xế nhận hai chuyến đồng thời và hai tài xế nhận một chuyến đồng thời: chỉ một assignment được commit.
- Hủy và assignment tranh chấp, callback mới sau hủy, callback replay sau hủy, event ID dùng lại khác payload.
- Sai thứ tự cập nhật, stale version, người ngoài xem/hủy và khách cố cập nhật trạng thái tài xế.
- Lịch sử phân trang ổn định, cursor của actor khác bị từ chối, không lẫn chuyến active.
- JWT sai định dạng/chữ ký/expiry/audience/role; callback dùng credential sai; DTO unknown field và idempotency header thiếu.
- Routing/Pricing sai dữ liệu/lỗi/timeout không tạo quote một phần; response quá lớn bị chặn trước khi parse.
- Transaction thất bại không để lại quote usage, history, receipt hoặc outbox một phần.
- Worker claim không trùng, lease hết hạn được reclaim, owner cũ không ACK, các đích tiến triển độc lập.
- Lỗi tạm thời giữ pending, credential sai giữ blocked, requeue sau sửa lỗi, cancel trước search không mở lại tìm.
- Receipt/outbox còn sau đóng/mở kết nối; worker khởi động lại tiếp tục delivery. Mock giữ terminal marker qua restart.
- Runtime DB role chạy nghiệp vụ được nhưng không ALTER TABLE/DELETE; migration job từ chối job đồng thời.
- Database từ chối COMPLETED thiếu final fare và JSON snapshot lệch các cột bảo vệ active/giá.

Kiểm tra bổ sung đã đạt: `lint`, `typecheck`, `build`, Docker image build, cấu hình cả ba Compose, cú pháp shell deploy và smoke test trên image cuối cùng. `npm audit` sau vá dependency báo **0 vulnerabilities**; kết quả này phản ánh dữ liệu audit tại thời điểm kiểm tra, không phải cam kết không có lỗi bảo mật.

Smoke Docker đã chạy: JWT → estimate → create/replay → chờ search → nhận chuyến → đến/bắt đầu/hoàn thành → tạo chuyến khác → hủy/replay → callback muộn bị từ chối. API/worker/DB/mock đều healthy, migration exit 0. Sau một lần host thiếu RAM, đã giới hạn app local 256 MiB/process và DB 512 MiB, khôi phục/kiểm tra file bị ảnh hưởng, rồi chạy lại smoke trong container thành công.

GitHub Actions workflow đã push. Chưa xác nhận kết quả run từ GitHub: API đọc trạng thái bị rate limit; không ghi CI remote là đã đạt. Có thể xem [Actions](https://github.com/fukdinh136/chande/actions) để kiểm tra.

## 4. Commit và feature

Các commit dưới đã push lên `origin/main`; tài liệu báo cáo được commit riêng sau khi hoàn tất kiểm tra.

| Commit | Nội dung |
| --- | --- |
| `50eef20` | Bootstrap, config và test tooling |
| `2963eb0` | State machine |
| `1cd4b46` | Trip aggregate và quote rules |
| `6ca9205` | Persistence/transaction PostgreSQL |
| `36b6b82` | Routing contract |
| `5bc3ece` | Pricing/money validation |
| `807bfb0` | Estimate và quote 5 phút |
| `f05eb74` | Matching command client |
| `e3d1035` | Outbox/lease/retry |
| `52ffb5a` | Create/quote usage/idempotency |
| `5e16e6c` | Assignment/inbox |
| `e0ed11f` | Cancel không phí/rematching |
| `a140c4f` | Tiến trình tài xế và hoàn thành |
| `222336d` | Get/active/history cursor |
| `130b219` | API/JWT/OpenAPI/E2E |
| `6f1b3b0` | Worker, probes, requeue và restart recovery |
| `7da155b` | DB integrity và giới hạn upstream response |
| `bbdfabe` | Worker readiness, JSON log và kiểm tra JWT bổ sung |
| `79799f2` | Vá dependency js-yaml cho Swagger |
| `65d8d4b` | Migration lock và kiểm thử runtime role |
| `c15b18a` | Bộ mock có receipt/terminal marker lưu trên disk |
| `ccf74e4` | Docker/Compose, smoke script và GitHub Actions |
| `f94cf6a` | Giới hạn RAM local, giữ shell script LF và dừng bootstrap khi SQL lỗi |

Không force-push. Commit template Expo và baseline tài liệu trước đó nằm ngoài danh sách feature Trip này.

## 5. Cách chạy lại

Từ `service/trip-service`, dùng Docker Desktop với Linux containers và Node.js 24:

```powershell
npm.cmd ci
docker compose -f compose.local.yml up -d --build
docker compose -f compose.local.yml ps
npm.cmd run smoke:local
```

API: <http://localhost:3001>; Swagger: <http://localhost:3001/docs>; worker readiness: <http://localhost:3002/health/ready>. JWT và nhận chuyến thử ở mock port 3003; hướng dẫn trong [Deploy](deploy.md). Stack local được để chạy khi bàn giao; DB test độc lập dùng trong phiên được dừng để tiết kiệm tài nguyên. Dừng stack bằng `docker compose -f compose.local.yml stop` nếu không dùng.

Kiểm thử portable với DB riêng:

```powershell
docker compose -f compose.test.yml up -d --wait
$env:TEST_DATABASE_URL = 'postgres://trip_test:trip_test@127.0.0.1:55434/trip_test'
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test:all
npm.cmd run build
npm.cmd audit
```

Bộ test trong phiên đã chạy trên PostgreSQL 18 ở port 55432, DB `trip_test`. Compose test dùng port 55434 để không trùng DB dev 55433 hoặc DB test có sẵn. Tests làm sạch các bảng Trip trong DB `_test`; giữ URL dev/production tách biệt.

## 6. Quyết định kỹ thuật đã hiện thực và cần review

- API envelope, status code, JWT RIDER/DRIVER, UUID, version, timestamp và decimal-string VND theo tài liệu cập nhật.
- `Store`/`Transaction` gộp các repository cần commit chung; SQL tham số hóa qua TypeORM, JSONB snapshot với cột/index/constraint và kiểm tra projection. Không đưa ORM vào domain.
- Use case nối bằng `TripContext` và `@Inject` tường minh; Zod dùng chung cho validation và OpenAPI.
- Matching được thêm O07 `trip.completed` để giải phóng reservation khi hoàn thành. O04 xử lý hủy; bên Matching thật cần xác nhận terminal marker/chống lặp và ACK bền vững.
- Outbox at least once, từng destination có trạng thái/lease/retry; consumer phải chống lặp và không đưa UI lùi về version cũ.
- NestJS 11 giữ nguyên; Swagger dùng override `js-yaml: 5.4.2` đã vá và kiểm tra lại OpenAPI. Lockfile lưu lựa chọn này.
- Hai migration: schema ban đầu và integrity bổ sung; API/worker không migrate. Compose deploy tách role/schema và dùng secret file.

Các lựa chọn này hoàn thiện thiết kế kỹ thuật; không thay đổi chính sách giá, hủy hoặc thời gian tìm xe đã chốt.

## 7. Phần còn lại ngoài phạm vi local

| Hạng mục | Trạng thái/bước tiếp theo |
| --- | --- |
| Service ngoài thật | Xác nhận O01–O07, callback/ACK, vehicle codes, snapshots và credentials; chạy integration tại môi trường chung |
| Gateway/mobile | Proxy R01–R07, giữ JWT/key/request ID, đăng ký realtime; frontend chưa nối API trong đợt này |
| Hosting/registry/domain/TLS | Chưa chọn/chưa publish image hoặc deploy lên host thật; Compose deploy mới kiểm tra cấu hình và quyền DB bằng integration test |
| Monitoring/backup/restore | Có probes/log/requeue; chưa lắp dashboard/exporter/alert hoặc chạy restore drill trên hosting |
| Retention và scale | Chưa cleanup quote/receipt/inbox/outbox tự động; chưa có load test hoặc HA benchmark |
| Nghiệm thu người dùng | Review nghiệp vụ, API, O07 và báo cáo trước khi phát hành môi trường thật |

Payment, rating, chat, GPS streaming, khiếu nại, admin và thuật toán tìm xe vẫn ngoài phạm vi v1 của Trip. Mock giá/Matching phục vụ kiểm thử, không thay cho nghiệp vụ các service đó.
