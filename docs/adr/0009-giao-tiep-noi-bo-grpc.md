# ADR-0009: gRPC cho giao tiếp nội bộ giữa các service Node

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Trip, Matching, Driver, Realtime, Routing, Price |
| Rà soát | 2026-11-15 |
| Quy ước | [Format và số liệu](../quy-uoc-tai-lieu.md) |

## Trạng thái

**Đề xuất — đã triển khai và đo** ngày 2026-11-15 trên nhánh `perf/adr-0008-trip-outbox`, mặc định vẫn là HTTP. Chờ nhóm quyết định có đổi mặc định sang gRPC hay không.

## Bối cảnh

Sáu service Node gọi nhau qua 11 luồng HTTP/JSON nội bộ: Matching → Realtime, Driver, Routing, Trip; Trip → Routing, Price, Matching; Driver → Trip, Matching; Realtime → Matching. Sau [ADR-0001](0001-matching-so-huu-tim-ung-vien.md) mỗi lần tìm xe là ba lời gọi đồng bộ, và ở 32 chuyến/giây có hàng chục nghìn lời gọi nội bộ mỗi phút. Mỗi lời gọi mở request HTTP/1.1, gửi và parse JSON, và chỉ có schema zod ở phía nhận làm hợp đồng; không có file hợp đồng chung cho cả hai phía.

## Quyết định

- Hợp đồng nội bộ viết bằng protobuf trong `proto/` ở gốc repo, mỗi service phía server một file (`trip.proto`, `matching.proto`, `driver.proto`, `realtime.proto`, `routing.proto`, `price.proto`) cộng `common.proto`. `scripts/sync-proto.cjs` chép vào từng service vì Docker build mỗi service từ thư mục riêng; `deploy/stack.test.cjs` báo lỗi khi bản sao lệch.
- **Chạy song song, có công tắc.** Mỗi service luôn phục vụ cả HTTP và gRPC (cổng 50051–50056). `INTERNAL_TRANSPORT=grpc` chuyển các client Node sang gRPC; mặc định `http`. Quay lại chỉ cần deploy lại không có biến.
- **Hành vi giống hệt HTTP.** Mỗi method gRPC kiểm cùng token dịch vụ (metadata `x-service-token`; JWT tài xế ở metadata `authorization` cho `GetActiveTrip`), kiểm dữ liệu bằng cùng quy tắc và gọi cùng use case. Lỗi gửi kèm metadata `x-http-status`, `x-error-code`, `retry-after`, nên client nhận lại đúng mã HTTP, mã lỗi và Retry-After; luật thử lại (A7), outbox `blocked`/thử lại và circuit breaker (D1) không phải viết lại.
- Một module `grpc.ts` giống hệt nhau trong sáu service (như `circuit-breaker.ts`, `telemetry.ts`): mỗi service đích một kết nối HTTP/2 lâu dài, mỗi client một circuit breaker, giới hạn message 1 MiB như giới hạn body HTTP hiện tại.
- Thư viện `@grpc/grpc-js` và `@grpc/proto-loader` (nạp `.proto` lúc chạy, không sinh code); trace qua `@opentelemetry/instrumentation-grpc` khi bật observability.
- Không đổi: API public qua Gateway, Gateway và User (Java), event tới Gateway/notification, RabbitMQ cho offer.

## Phương án đã cân nhắc

| Phương án | Lý do không chọn |
| --- | --- |
| Thay hẳn HTTP nội bộ | Không đo được HTTP và gRPC trên cùng code; mất đường lùi. Có thể làm sau theo kiểu expand → migrate → contract như ADR-0001 nếu nhóm đổi mặc định |
| Sinh code TypeScript từ proto (`ts-proto`, `buf`) | Thêm bước build và công cụ cho sáu service; dữ liệu nhận về vẫn được kiểm bằng zod như HTTP nên lợi ích về kiểu nhỏ |
| gRPC cho cả Gateway và User (Java) | Khối lượng lớn (Spring, grpc-java) trong khi các luồng nóng đều giữa service Node |
| Đổi build Docker về gốc repo để dùng chung `proto/` | Phải sửa mọi Dockerfile và `deploy/run.cjs`; bản sao có kiểm tra tự động đơn giản hơn |

## Hệ quả

- Tích cực: hợp đồng nội bộ thành file chung cho cả hai phía; CPU các service Node giảm 7–21% ở cùng tải ([báo cáo kiểm thử tải, mục 13](../bao-cao-kiem-thu-tai.md#13-http-và-grpc-giữa-các-service-2026-11-15)); độ trễ không tệ hơn.
- Tiêu cực: mỗi API nội bộ có hai mặt (HTTP và gRPC) phải giữ khớp; mỗi pod API mở thêm một cổng; image thêm hai gói npm.
- Trung tính: số câu SQL và việc mỗi service làm không đổi.

## Tiêu chí hoàn thành

| Tiêu chí | Kết quả 2026-11-15 |
| --- | --- |
| Test mỗi service: server gRPC với token sai, dữ liệu sai, lỗi nghiệp vụ; client nhận cùng mã lỗi như HTTP | Đạt: Matching 37 test, Trip 63 unit + 13 contract, Driver 31, Realtime 8, Routing 9 integration, Price 2 integration |
| Smoke trên Kubernetes ở cả `http` và `grpc` | Đạt |
| Đo tải cùng code, chỉ đổi giao thức: không tệ hơn HTTP về số chuyến gán và p95 | Đạt ở 8, 16, 32 chuyến/giây (lần gRPC 32 đầu dao động, lần đo lại đạt) |
