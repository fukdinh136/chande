# ADR-0005: Payment service với sổ cái kép và Try-Confirm-Cancel

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Payment (mới), Trip, API Gateway |
| Rà soát | 2026-10-27 |
| Quy ước | [Format và số liệu](../quy-uoc-tai-lieu.md) |

## Trạng thái

Đề xuất — phase 2, cải tiến P2.1 trong [Kiến trúc mục tiêu](../kien-truc-muc-tieu.md).

## Bối cảnh

Phase 2 cần thanh toán tiền mặt và ví nội bộ, có hoa hồng cho nền tảng. Không dùng cổng thanh toán thật. Giá chuyến đã chốt trong báo giá và không đổi trong chuyến, nên số tiền cần giữ bằng đúng số tiền sẽ thu.

Ví điện tử của các ứng dụng lớn dựa trên hai mẫu:

- **Sổ cái kép (double-entry ledger):** mọi thay đổi tiền là một bút toán có các dòng ghi nợ / có với tổng bằng 0. Tiền không tự sinh ra hay mất đi, số dư luôn tính lại được từ lịch sử.
- **Giữ tiền trước (pre-authorization):** giữ tiền khi đặt, chốt khi hoàn thành, nhả khi huỷ.

Nhóm có một thành viên Java. Tiền là miền cần transaction chặt, phù hợp Java + Postgres.

## Quyết định

**Service mới** `service/payment-service`: Java 21 + Spring Boot, DB logic `payment` trên Postgres hiện có.

**Dữ liệu:**

| Bảng | Nội dung |
| --- | --- |
| `accounts` | Tài khoản theo chủ sở hữu: ví khách, ví tài xế, doanh thu nền tảng, tiền nạp giả lập |
| `journal_entries` | Một bút toán; `idempotency_key` duy nhất (ví dụ `capture:<tripId>`) |
| `postings` | Dòng nợ / có (số nguyên VND, có dấu); kiểm tổng bằng 0 trong cùng transaction |
| `holds` | Tiền giữ: `trip_id` duy nhất, `amount`, `status` (`HELD`, `CAPTURED`, `RELEASED`, `EXPIRED`), `expires_at` |
| `processed_events` | Inbox cho consumer `trip.events` |

Payment cũng consume `trip.searching` để gắn hold với chuyến đã tạo thành công (xem bảng luồng ví bên dưới); cần thêm Payment vào consumer của `trip.searching` trong [danh mục sự kiện](../kien-truc-muc-tieu.md#7-danh-mục-sự-kiện).

Số dư khả dụng = số dư sổ cái − tổng hold đang `HELD`. Tiền dùng `BigInteger` / `bigint` và chuỗi trên wire như quy ước hiện có.

**Luồng ví — Try-Confirm-Cancel:**

| Bước | Kích hoạt | Hành động |
| --- | --- | --- |
| Try | Trip tạo chuyến với `paymentMethod=WALLET`, gọi `POST /internal/payments/holds` (idempotent theo `tripId`) **trước** khi commit | Đủ tiền thì tạo hold; thiếu thì Trip trả lỗi `INSUFFICIENT_BALANCE`; Payment không phản hồi thì Trip từ chối WALLET, gợi ý tiền mặt |
| Confirm | `trip.completed` | Capture: ví khách → ví tài xế (80 %) + doanh thu nền tảng (20 %) |
| Gắn chuyến | `trip.searching` của đúng `tripId` | Hold được gắn chuyến và bỏ hạn, để chuyến dài không bị nhả tiền giữa chừng |
| Cancel | `trip.cancelled`, hoặc hold chưa gắn chuyến mà quá `expires_at` (15 phút; xảy ra khi Trip lỗi sau bước Try) | Release hold |

**Luồng tiền mặt:** `trip.completed` ghi bút toán tài xế nợ nền tảng phần hoa hồng; tài xế thanh toán công nợ bằng ví.

**API:** khách xem số dư, nạp tiền giả lập, lịch sử; tài xế xem thu nhập; admin tra cứu. Tất cả qua Gateway. Payment phát `payment.captured` / `payment.failed` lên `payment.events`.

Tỉ lệ hoa hồng là cấu hình, ghi vào bút toán tại thời điểm capture để đổi tỉ lệ không làm sai lịch sử.

## Phương án đã cân nhắc

| Phương án | Lý do không chọn |
| --- | --- |
| Saga hoàn toàn bất đồng bộ (giữ tiền sau khi nghe `trip.searching`) | Khách chỉ biết thiếu tiền sau khi chuyến đã tạo, phải thêm luồng huỷ bù; UX kém hơn |
| Lưu số dư một cột, cộng trừ trực tiếp | Không kiểm toán được, dễ sai khi chạy song song; không đúng tinh thần ví thật |
| Đặt thanh toán trong Trip | Trộn hai miền có vòng đời và yêu cầu nhất quán khác nhau |
| Cổng VNPay / MoMo sandbox | Cần tunnel cho callback IPN, demo trên máy local không ổn định |

## Hệ quả

- Tích cực: minh hoạ rõ saga / TCC, idempotency và sổ cái kép, đều là điểm cộng kiến trúc; Trip chỉ thêm một lời gọi Try và một trường `paymentMethod`.
- Tiêu cực: Trip phụ thuộc đồng bộ vào Payment khi tạo chuyến bằng ví (có đường lui tiền mặt); thêm service Java ~0,4 GB RAM; contract tạo chuyến thay đổi (cần cập nhật [hợp đồng liên service](../hop-dong-lien-service.md)).

## Tiêu chí hoàn thành

- Test: tổng `postings` của mọi bút toán bằng 0; replay `trip.completed` không tạo bút toán thứ hai; huỷ chuyến trả số dư khả dụng về như trước.
- Test tranh chấp: hai chuyến đồng thời không thể cùng giữ vượt số dư.
- Demo: thiếu tiền bị từ chối ngay; hoàn thành chuyến thì ví tài xế và doanh thu tăng đúng tỉ lệ.
