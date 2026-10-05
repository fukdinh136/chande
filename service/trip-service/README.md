# Trip Service

Service quản lý nghiệp vụ chuyến đi của Chande, từ báo giá và đặt xe đến nhận chuyến, cập nhật tiến trình, hoàn thành hoặc hủy.

## Tài liệu

| Tài liệu | Nội dung |
| --- | --- |
| [Nghiệp vụ](docs/nghiep-vu.md) | Phạm vi v1, quy tắc đã chốt, vòng đời, user story và tiêu chí nghiệm thu |
| [Kiến trúc](docs/kien-truc.md) | Ranh giới service, lớp/port/adapter, dữ liệu, transaction và outbox |
| [API](docs/api.md) | Model, request/response, identity, idempotency, lỗi và contract tích hợp |
| [Routes](docs/routes.md) | Bảng route public/internal/outbound, quyền, use case và exposure |
| [Deploy](docs/deploy.md) | Runtime API/worker/DB, cấu hình, migration, phát hành, rollback và monitoring |

[Mục lục tài liệu dự án](../../docs/README.md).

## Trạng thái phát triển

Thư mục service và tài liệu đã được tổ chức riêng. Chưa triển khai ứng dụng backend, các component nghiệp vụ, OpenAPI, Dockerfile hoặc cấu hình deploy. Các tài liệu kỹ thuật là bản thiết kế đề xuất để review, không xác nhận endpoint hay runbook đã chạy được.

Stack đã thống nhất: NestJS, TypeScript, TypeORM và PostgreSQL. Routing, Pricing và Matching được tích hợp qua contract; REST callback và outbox phục vụ luồng bất đồng bộ.

Domain sẽ độc lập với NestJS, TypeORM và HTTP client. Tài liệu trong `docs/` là cơ sở để validate thiết kế từng component trước khi code.

## Quy trình

Người dùng duyệt thiết kế component, sau đó duyệt kết quả kiểm thử. Chỉ commit và push `main` sau khi kết quả được duyệt, theo quy trình trong tài liệu nghiệp vụ.
