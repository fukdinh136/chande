# Architecture Decision Records

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Toàn hệ thống |
| Rà soát | 2026-10-30 |
| Quy ước | [Format và số liệu](../quy-uoc-tai-lieu.md) |

Mỗi ADR ghi một quyết định kiến trúc: bối cảnh, quyết định, các phương án đã cân nhắc và hệ quả. Bối cảnh tổng thể và lộ trình nằm trong [Kiến trúc mục tiêu](../kien-truc-muc-tieu.md).

## Trạng thái

- **Đề xuất:** đã viết, chờ nhóm duyệt.
- **Đã chấp nhận:** nhóm đồng ý, đang hoặc đã triển khai.
- **Thay thế bởi ADR-xxxx:** không còn hiệu lực.

Không sửa nội dung một ADR đã chấp nhận. Khi đổi quyết định, viết ADR mới và đánh dấu ADR cũ là bị thay thế.

## Danh sách

| ADR | Quyết định | Phase | Trạng thái |
| --- | --- | --- | --- |
| [0001](0001-matching-so-huu-tim-ung-vien.md) | Matching sở hữu việc tìm ứng viên, gỡ vòng gọi qua Routing / Realtime / Driver | 1 | Đề xuất |
| [0002](0002-truc-su-kien-rabbitmq.md) | Event của Trip phát qua RabbitMQ topic exchange, không dùng Kafka | 1 | Đề xuất |
| [0003](0003-observability-opentelemetry.md) | OpenTelemetry + Prometheus + Grafana + Jaeger | 1 | Đề xuất |
| [0004](0004-gioi-han-thoi-gian-tim-xe.md) | Deadline tìm xe, huỷ bởi hệ thống với lý do `NO_DRIVER_FOUND` | 1 | Đề xuất |
| [0005](0005-payment-so-cai-kep-tcc.md) | Payment service: sổ cái kép, ví nội bộ, Try-Confirm-Cancel | 2 | Đề xuất |
| [0006](0006-gia-dong-theo-o-h3.md) | Giá động theo ô H3 và khuyến mãi, khoá trong báo giá | 2 | Đề xuất |
| [0007](0007-admin-web-va-role-admin.md) | Admin web React riêng, role `ADMIN` kiểm ở Gateway | 2 | Đề xuất |
| [0008](0008-xu-ly-hang-doi-lien-tuc.md) | Outbox Trip, publisher và worker Matching xử lý hàng đợi liên tục thay vì mỗi nhịp một lô | 1 | Đề xuất |

## Mẫu

```text
# ADR-xxxx: <quyết định ngắn>
Bảng metadata
## Trạng thái
## Bối cảnh
## Quyết định
## Phương án đã cân nhắc
## Hệ quả
## Tiêu chí hoàn thành
```
