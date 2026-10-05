# Kế hoạch phát triển

| Thuộc tính | Giá trị |
| --- | --- |
| Service | matching-service |
| Rà soát | 2026-10-06 |
| Quy ước | [Format và số liệu](../../../docs/quy-uoc-tai-lieu.md) |

| Feature | Nội dung | Kiểm chứng |
| --- | --- | --- |
| M00 | Tài liệu nghiệp vụ/C3/API/deploy | Ranh giới và contract hiện tại |
| M01 | Package strict/config/auth/domain/ports | Thời gian, quyền, ranking, transitions |
| M02 | PostgreSQL/migration/constraints/receipts/outbox/lease | Race, terminal trước search, restart |
| M03 | Internal lookups/availability/Realtime HTTP/vehicle/JWT | Contract từng service, fail closed |
| M04 | ETA polling/offer tuần tự | Freshness, busy/tried/no-route/tie |
| M05 | Decisions/callback/reconcile | Retry mất ACK, cancel race, ownership |
| M06 | Rabbit publisher/Realtime consumer/rooms/reconnect | Confirms, duplicate/version/tombstone |
| M07 | Docker/CI/smoke Hà Nội/báo cáo | Luồng thật, cancel/complete, giá giữ nguyên |

Mỗi feature kiểm thử, cập nhật báo cáo và commit/push nhỏ. Không ghi đè config secret local. Phân biệt test đã chạy local với CI chưa chạy; ghi rõ hạn chế khi bàn giao.
