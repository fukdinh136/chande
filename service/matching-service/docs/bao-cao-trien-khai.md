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
