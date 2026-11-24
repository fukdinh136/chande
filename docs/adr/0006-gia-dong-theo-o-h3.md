# ADR-0006: Giá động theo ô H3 và khuyến mãi

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Price, Realtime, Trip |
| Rà soát | 2026-10-27 |
| Quy ước | [Format và số liệu](../quy-uoc-tai-lieu.md) |

## Trạng thái

Đề xuất — phase 2, cải tiến P2.2 trong [Kiến trúc mục tiêu](../kien-truc-muc-tieu.md).

## Bối cảnh

Price hiện tính giá thuần theo quãng đường: giá mở cửa + phần km vượt mức. Trip chốt giá trong báo giá có hạn 5 phút, nên chuyến không đổi giá giữa chừng. Đây chính là mẫu "giá chốt trước" (upfront pricing).

Các ứng dụng lớn tăng giá theo cung cầu từng khu vực. Uber chia bản đồ thành ô lục giác H3 (thư viện mã nguồn mở) vì các ô có diện tích gần đều nhau và mỗi ô có đúng 6 ô kề.

Request của Price hiện chỉ có `route` và `vehicleType`, không có toạ độ đón.

## Quyết định

**Đơn vị khu vực:** ô H3 độ phân giải 8 (cạnh ~460 m), tính bằng thư viện `h3-js` trong Price.

**Cầu:** Price consume `trip.searching` (xem [ADR-0002](0002-truc-su-kien-rabbitmq.md)) và tăng bộ đếm Redis theo ô của điểm đón, cửa sổ trượt 5 phút.

**Cung:** mỗi 60 giây Price gọi **một lần** API mới ở Realtime `GET /internal/realtime/supply-snapshot` để lấy số tài xế có GPS mới theo ô. Realtime chỉ đếm vị trí, không cần biết luật giá.

**Hệ số:**

```text
raw = 1 + k × (cầu / max(cung, 1) − 1)
m   = clamp(α × raw + (1 − α) × m_trước, 1.0, 2.0)
```

`k`, `α` và trần 2.0 là cấu hình. Kết quả lưu Redis theo ô, TTL 3 phút. Thiếu dữ liệu hoặc Redis lỗi thì `m = 1.0` (an toàn cho khách).

**Báo giá:** Trip gửi thêm `pickup` sang Price; Price trả breakdown thêm dòng `SURGE` (và `PROMO` nếu có mã). Trip lưu nguyên breakdown trong quote, nên giá đã chốt không đổi khi hệ số đổi.

**Khuyến mãi (Should):** bảng `promotions` (mã, % hoặc số tiền, trần, hạn dùng, giới hạn lượt / người) và `promotion_redemptions` (`code`, `userId`, `tripId` duy nhất). Reserve khi tạo chuyến, confirm khi `trip.completed`, release khi `trip.cancelled`, cùng mẫu Try-Confirm-Cancel với [ADR-0005](0005-payment-so-cai-kep-tcc.md).

**Quan sát:** metric `surge_multiplier{cell}` để vẽ bản đồ trên Grafana và Admin.

## Phương án đã cân nhắc

| Phương án | Lý do không chọn |
| --- | --- |
| Lưới geohash vuông | Ô không đều diện tích và số ô kề khác nhau; H3 là mẫu được dùng phổ biến hơn cho surge |
| Price gọi Realtime trên mỗi báo giá | Thêm phụ thuộc đồng bộ vào đường báo giá; tính trước theo chu kỳ rẻ và ổn định hơn |
| Tính surge trong Realtime | Realtime sẽ phải biết luật giá; trái ranh giới service |
| Đổi giá theo thời gian thực trong chuyến | Mâu thuẫn quy tắc giá cố định đã chốt ở giai đoạn 1 |

## Hệ quả

- Tích cực: Price là consumer đầu tiên chứng minh giá trị của trục event; minh hoạ tính toán gần thời gian thực mà không làm nặng đường báo giá.
- Tiêu cực: contract Trip → Price thay đổi (thêm `pickup`, breakdown mới) nên phải cập nhật [hợp đồng liên service](../hop-dong-lien-service.md) và `contract-baseline.json`; cung tính theo GPS nên tài xế đang chở khách vẫn bị đếm (chấp nhận được cho demo).

## Tiêu chí hoàn thành

- Giả lập 30 chuyến `SEARCHING` trong một ô có 3 tài xế: báo giá ô đó tăng, ô kề không đổi, hệ số không vượt trần.
- Tắt Redis: báo giá vẫn trả với `m = 1.0`.
- Mã khuyến mãi không bị dùng quá giới hạn khi hai chuyến tạo đồng thời.
