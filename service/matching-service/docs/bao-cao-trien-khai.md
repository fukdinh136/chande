# Báo cáo triển khai

## M00

Đã lưu quyết định người dùng, C3 điều chỉnh, API/routes, deploy và thứ tự feature. Đối chiếu checkout main có Driver/Realtime. Ghi nhận cần producer availability, adapter Routing→Realtime, Rabbit consumer và audience Matching; Trip callback thực tế 202.

Kiểm tra tài liệu Markdown và đường dẫn. Các feature runtime sẽ ghi kết quả thực chạy ở các mục tiếp theo.

## M01–M02

Package/lockfile, compiler strict, JWT DRIVER, credential loader, domain và ranking đã triển khai. 4 unit tests pass; typecheck/lint pass. PostgreSQL riêng port 55435 kiểm chứng receipt race/replay/conflict, terminal trước search và reconnect; migration không synchronize hoặc đổi schema service khác.

## M03

Trip có credential riêng cho batch active-driver và lookup matching-state; tách verifier RIDER/DRIVER theo issuer được cấu hình. Driver batch nearby đối soát active Trip/reservation trước khi giữ lock Driver, projection không được suy từ GPS. Routing HTTP adapter dùng API Realtime đã merge, lọc wire fields/freshness và truyền vehicleType; cap 50/batch 25. Mapping CAR_4/CAR_7 giữ mức giá mẫu CAR hiện tại. Tài liệu callback sửa đúng 202.

Local: Trip unit 55, Routing unit 30, Driver unit/contract/e2e 25, Price unit 5 pass; typecheck/lint các service pass. Chưa coi đây là kiểm chứng toàn bộ luồng Docker/Hà Nội.

## M04

Đã triển khai HTTP clients có deadline/response cap, ranking, search polling, offer 20 giây, reservation cạnh tranh và expiry. PostgreSQL test xác nhận hai chuyến chỉ một chuyến giữ được driver; chuyến còn lại vẫn SEARCHING, driver hết hạn không bị mời lại. Lỗi truy vấn join ambiguous phát hiện trong test đã sửa bằng alias.

## M05

REST nội bộ và driver, strict schemas, credential scopes, durable decision receipts và assignment reconciliation đã triển khai. Callback giữ snapshot/eventId; network mất ACK sau Trip commit được xác nhận bằng matching-state, không gửi assignment mới. Local PostgreSQL/HTTP tests: replay accept, key conflict, decline sau accept, ownership, scope token và cancel sau assignment không mở lại reservation. Worker có lease renewal, backoff và job giới hạn thời gian.

## M06

Publisher persistent/mandatory/confirms, durable queue, manual ACK, delay queues và DLQ đã triển khai. Realtime join room từ JWT, truy vấn offer authoritative trước phát/reconnect; cache Redis giữ version/tombstone 7 ngày, không reset expiresAt. RabbitMQ thật và PostgreSQL: publisher chỉ đánh dấu delivered sau confirm, giữ message ID. Realtime test kiểm tra message cũ sau revoke, duplicate, expiry, đúng driver room và malformed.

Matching: 5 unit + 4 PostgreSQL/RabbitMQ integration tests pass; Realtime build/lint + consumer test pass. CTE claim sửa để final SELECT trả rows trực tiếp, tránh tuple UPDATE của TypeORM; đã thêm test claim positive và lease exclusion.

## M07 — Docker, kiểm thử tích hợp và bàn giao

Đã thêm Dockerfile Matching/Realtime, stack độc lập `chande-matching-local`, fixture Driver cho database mới, smoke script, OpenAPI và workflow CI. Worker quét expiry độc lập với I/O tìm xe; outbox có lệnh requeue giữ event ID. Driver availability và quyền đổi xe đối soát cả active Trip lẫn reservation. Trip chọn verifier theo issuer tin cậy để JWT Driver không phụ thuộc issuer RIDER.

Assignment lưu cờ đã bắt đầu callback trước HTTP. Khi kết quả chưa rõ, retry dùng cùng snapshot/event ID và giữ reservation, kể cả hồ sơ Driver thay đổi giữa các lần thử. Cancel trong khi callback đang chạy không mở lại search hoặc reservation. Đã kiểm thử decline thành công rồi mời người tiếp theo, accept lặp, snapshot giả, expiry sweep và consumer retry/DLQ.

### Kết quả local ngày 06/10/2026

| Kiểm tra | Kết quả thực chạy |
| --- | --- |
| Matching | 5 unit + 4 integration PostgreSQL/RabbitMQ pass; typecheck/lint/build pass |
| Trip | 89 tests `test:all` pass, không skip; typecheck/lint pass |
| Routing | 30 unit pass; typecheck/lint pass |
| Price | 5 unit pass; typecheck/lint pass |
| Driver | 25 tests pass; typecheck/lint pass |
| Realtime | 2 consumer tests pass; build/lint pass |
| OpenAPI | 12 paths; request schemas và response accept 202 kiểm tra qua HTTP |
| Dependency Matching | `npm audit --omit=dev`: 0 vulnerabilities tại thời điểm kiểm tra |
| Docker | Build và startup healthy; stop/restart API, worker, consumer thành công trên Linux containers |

Smoke dùng Driver đăng nhập/JWT thật, GPS Socket.IO, Redis/RabbitMQ/PostgreSQL thật, Routing OSRM ô tô Hà Nội, Price và Trip runtime. CAR_4: Trip `fb5c8225-155d-4fdf-b5b6-fecfa1e88121`, offer `8b42d567-4a5b-41ed-82c7-9da80e222024`, kết thúc COMPLETED. CAR_7: Trip `7d5d2d76-1474-48a1-b991-a02989f7b474`, offer `1a7b9b3b-ad45-456e-92b8-5fd1f563ef62`, kết thúc CANCELLED.

Cả hai nhận offer qua WebSocket, reconnect nhận lại cùng offer/hạn, accept REST rồi Trip ASSIGNED. Driver BUSY khi giữ offer và AVAILABLE sau kết thúc; reservation đã giải phóng. Tuyến mẫu 2.546 m có quote 27.460 VND; giá Trip giữ nguyên. Smoke này chạy lại sau khi stop/start Matching API, worker và Realtime. Worker exit 0; Nest API/Realtime exit 143 do SIGTERM, không OOM hoặc SIGKILL.

### Commit theo feature

| Feature | Commit |
| --- | --- |
| M00 | `c66245d` — tài liệu và contracts |
| M01 | `3eaf9ef` — domain/config/auth |
| M02 | `ae55a68` — persistence/receipts/reservations/lease |
| M03 | `fe48c65` — GPS/availability/vehicle/identity |
| M04 | `9e1f3d7` — ranking và offer tuần tự |
| M05 | `33d4683` — quyết định và callback/đối soát Trip |
| M06 | `1fa1faf` — Rabbit publisher và Realtime delivery |
| M07 | `2c82f85` — Docker/CI/smoke Hà Nội và bàn giao |

### Phạm vi đã xác minh và phần còn lại

GitHub Actions đã hoàn tất **success** cho commit runtime `2c82f85`: [Matching Service](https://github.com/fukdinh136/chande/actions/runs/37379263559), [Trip Service](https://github.com/fukdinh136/chande/actions/runs/37379263386), [Routing Service](https://github.com/fukdinh136/chande/actions/runs/37379263364). Workflow Matching chạy PostgreSQL/Rabbit integration, checks các service liên quan và Docker build Matching/Realtime; smoke Hà Nội là kiểm chứng local riêng, không tải dataset OSRM trong CI.

Smoke gọi REST Matching trực tiếp, chưa kiểm chứng ingress Gateway hoặc UI thiết bị. RIDER issuer và Gateway/Notification event sink dùng mock; fixture SQL chỉ dành database Driver mới của stack smoke, không phải migration production. BIKE OSRM thật, GPS background/traffic, nhiều replica và hosting production chưa nghiệm thu. Không ghi đè `.env`, key/token local hoặc xóa volume có sẵn.

Chạy lại, startup/shutdown, requeue và giới hạn Gateway: [runbook](deploy.md). Component/source và C3: [kiến trúc](kien-truc.md). Contract và quyền: [API](api.md).
