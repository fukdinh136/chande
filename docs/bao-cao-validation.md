# Báo cáo validation toàn bộ service

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Toàn hệ thống |
| Rà soát | 2026-10-06 |
| Quy ước | [Format và số liệu](quy-uoc-tai-lieu.md) |

Ngày kiểm tra: 2026-10-06. Phạm vi tám service trong checkout hiện tại: User, Gateway, Driver, Realtime, Trip, Routing, Price, Matching. Chỉ chỉnh tài liệu/checker; không đổi nghiệp vụ/runtime, không ghi đè .env/key/token hoặc xóa volume hiện có.

## Kiểm thử thực chạy

| Service | Command trong thư mục service | Pass | Fail | Skip | Phạm vi / điều kiện |
| --- | --- | --- | --- | --- | --- |
| Trip | npm.cmd run test:all | 89 | 0 | 0 | Unit, contract, HTTP/e2e và PostgreSQL test 55434 |
| Routing | npm.cmd run test:all | 44 | 0 | 0 | Unit/contract/API/lifecycle; provider fixture trong suite, OSRM thật trong smoke riêng |
| Price | npm.cmd run test:all | 6 | 0 | 0 | Policy/formula và HTTP contract |
| Driver | npm.cmd test + npm.cmd run test:integration | 25 + 2 | 0 | 0 | Unit/contract/e2e; PostgreSQL fixture test 55437 và Redis riêng 16379/15 |
| Realtime | npm.cmd test | 2 | 0 | 0 | Consumer version/expiry/room/retry/DLQ; GPS/nearby thật trong smoke |
| Matching | npm.cmd test + npm.cmd run test:integration | 5 + 4 | 0 | 0 | PostgreSQL 55435/Rabbit 5673; race, receipts, lease, terminal và callback |
| User | .\mvnw.cmd -B verify | 205 | 0 | 0 | 109 core + 92 adapters + 4 app; PostgreSQL qua Testcontainers |
| Gateway | .\mvnw.cmd -B verify | 73 | 0 | 0 | Gồm 5 Redis → WebSocket integration tests trên Redis tạm localhost:6379 |

Tổng **455 test pass**, không fail/skip ở các suite đã chạy. Ban đầu Gateway báo 68 pass vì BeforeAll bỏ nguyên suite Redis (XML tests=0 dù skipped=0); đã bổ sung Redis riêng và chạy lại đủ 73. Driver storage test dùng schema fixture hiện có của stack smoke, không chứng minh DDL production đã được owner xác nhận. Không dùng database Driver/Redis production hay volume stack khác làm target test.

Sáu service Node đều qua typecheck/lint/build; Driver check:architecture/check:schema đạt (source safety check, không phải schema diff). User/Gateway Maven verify build đạt. `test:all` không có nghĩa mọi loại integration/thiết bị đã có test; số trên chỉ đếm assertions của các suite thực chạy.

## Smoke Hà Nội chạy lại

`npm.cmd run smoke:local` trong Matching dùng stack Docker hiện có, GPS Socket.IO, Driver JWT thật, PostgreSQL/Redis/RabbitMQ thật, Routing OSRM ô tô Hà Nội, Price và Trip runtime.

| Scenario | Trip ID | Kết thúc | Route | Quote/final VND | Kết quả |
| --- | --- | --- | --- | --- | --- |
| CAR_4 | 4d3ca0b8-ce59-4fc7-89f4-1cbe13b94387 | COMPLETED | 2546 m | 27460 | WS/reconnect, accept REST, assignment, giá giữ nguyên, reservation giải phóng |
| CAR_7 | 52cf1d64-1817-4155-916d-dad7c286928c | CANCELLED | 2546 m | Quote 27460, final null | WS/reconnect, accept REST, assignment, reservation giải phóng |

RIDER issuer và Gateway/Notification event sinks vẫn mock. Chưa nghiệm thu User thật → Gateway → Trip hoặc Matching offer UI trên thiết bị. Không dùng số đo tuyến fixture 4000 m/600 giây thay cho smoke OSRM thật; BIKE real chưa bật. Runbook: [Matching](../service/matching-service/docs/deploy.md).

## Tài liệu đã chuẩn hóa

- README/docs của tám service dùng UTF-8 không BOM/LF, một H1, metadata Service/Rà soát/Quy ước, bảng delimiter thống nhất, code fence có ngôn ngữ và link tương đối.
- Mục lục chung có đủ tám service. Sửa link User/Gateway sau khi thư mục được chuyển vào service/, đổi ví dụ JSON có comments/multiple bodies thành pseudocode text.
- Thêm [format chuẩn](quy-uoc-tai-lieu.md), [hợp đồng/số liệu chung](hop-dong-lien-service.md), [baseline source](contract-baseline.json) và checker chạy bằng `node scripts/validate-docs.cjs`.
- Checker đạt: 52 tài liệu UTF-8, 377 link local, 50 JSON examples và 26 baseline checks với source. .gitattributes giữ LF cho README/docs service khi checkout trên Windows/Linux; không đổi line ending mã runtime.
- Đối chiếu cổng default/compose, quote 5 phút, offer 20 giây, search polling 5 giây, freshness GPS 30 giây, radius 2000 m, cap 50/batch 25 và Routing deadline 4000 ms.
- Bổ sung CAR_4/CAR_7, giá mẫu và OSRM graph car; giữ CAR/MOCK_BIKE là legacy/mock explicit. Giá mẫu và tiền thu theo distance được phân biệt khỏi ETA/duration.
- Trip API/routes có lookup Driver/Matching và assignment 202; sửa replay header thành Idempotent-Replay theo code. Driver docs cập nhật occupancy/reservation, không mô tả Matching chiếm Redis lock legacy.
- Realtime docs/C3/routes/deploy cập nhật offer consumer/Rabbit/Matching state lookup, room từ JWT/reconnect và lockfile/Docker đã có; bỏ các khẳng định cũ rằng chưa tích hợp.
- Giữ nguyên số test/benchmark/ngày trong báo cáo feature lịch sử. Bảng đầu báo cáo này là số test hiện tại, không thay 30 unit Routing thành 44 tests cùng phạm vi hoặc biến fixture/mock thành kết quả thật.

## Khoảng trống runtime được ghi nhận

| Điểm | Bằng chứng source | Trạng thái |
| --- | --- | --- |
| Gateway → Matching | application.yaml/SecurityConfig chưa có matching-service hoặc path /matching/offers | Cần feature proxy/security riêng; REST trực tiếp đã smoke |
| Gateway → Routing | Placeholder /routing/** → port 8000; Routing thật port 3004, /routes/** và service credential | Chưa tương thích; không đổi số trong docs để che cấu hình runtime |
| CORS replay header | Trip trả Idempotent-Replay; Gateway expose Idempotency-Replayed | Browser không đọc được header hiện tại qua Gateway; cần fix CORS |
| User auth legacy | Gateway whitelist OTP/password-reset User 0.1; User v2 không có | Upstream trả 404; whitelist không chứng minh endpoint tồn tại |
| WS transport | Gateway /ws thuần và LoggingLocationForwarder; Realtime Socket.IO /realtime | Không dùng thay thế nhau; GPS Gateway → Realtime chưa nối |
| Default ports | Realtime/Routing đều 3004, Driver/Trip mock đều 3003 | Phải override; Matching compose đã dùng ports riêng |
| Production | BIKE OSRM, OTP provider, thiết bị/background, HA/hosting và DDL Driver | Chưa nghiệm thu từ suite local này |

Đợt này xác minh và ghi rõ các khoảng trống, không triển khai thêm API/ingress hoặc đổi contract User để giả thống nhất. Tài liệu áp dụng cả cấu hình standalone lẫn stack Matching, với phạm vi riêng.

## Local, CI và working tree

Kết quả trên là **local tại checkout hiện tại**. CI runtime đã xác minh ở đợt Matching trước cho `2c82f85`: [Matching](https://github.com/fukdinh136/chande/actions/runs/37379263559), [Trip](https://github.com/fukdinh136/chande/actions/runs/37379263386), [Routing](https://github.com/fukdinh136/chande/actions/runs/37379263364). Không coi CI đó là CI đã chạy cho toàn bộ đợt chuẩn hóa tài liệu hoặc hai thư mục Java mới chuyển.

Working tree ban đầu đã có User/Gateway chuyển từ root vào service/ nhưng chưa commit. Đã rà và sửa tài liệu ở đường dẫn mới; không stage/commit/xóa các thay đổi di chuyển runtime của người dùng. Các container validation Driver/Gateway tạo riêng không gắn named volume; sau tests được dọn riêng, giữ nguyên stack OSRM/Trip/Matching và dữ liệu hiện có.

## Chạy lại

Chạy commands trong bảng đầu sau khi `npm.cmd ci` ở từng service Node; Java dùng Maven Wrapper. Tests cần storage riêng: Trip TEST_DATABASE_URL, Matching MATCHING_TEST_DATABASE_URL/MATCHING_TEST_RABBIT_URL, Driver DRIVER_TEST_DATABASE_URL/DRIVER_TEST_REDIS_URL và DRIVER_TEST_STORAGE_ACK=ISOLATED_DRIVER_TEST_ONLY. Driver URL phải thỏa helper test (DB kết thúc _driver_test; Redis 16379/15). Không trỏ integration suite vào dữ liệu dùng thật.

Gateway Redis suite hiện cố định localhost:6379; nếu port đó có Redis dữ liệu chung thì không chạy suite vào instance đó. User Testcontainers tự quản container riêng; fallback DB phải là database test đã xác nhận. Fixture/constraints Driver không phải DDL production.

Checker chỉ đọc docs, source và config mẫu, không đọc secrets. Baseline drift là tín hiệu cần đối chiếu source/decision rồi cập nhật tài liệu/expectation có chủ đích.
