# ADR-0004: Giới hạn thời gian tìm xe

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Matching, Trip |
| Rà soát | 2026-10-27 |
| Quy ước | [Format và số liệu](../quy-uoc-tai-lieu.md) |

## Trạng thái

Đề xuất — phase 1, cải tiến P1.2 trong [Kiến trúc mục tiêu](../kien-truc-muc-tieu.md).

## Bối cảnh

Matching tìm xe theo vòng: mời tuần tự từng tài xế, mỗi offer sống 20 giây (20000 ms); hết ứng viên thì chờ `SEARCH_POLL_MS` rồi tìm lại. Không có giới hạn tổng thời gian, nên chuyến không có tài xế ở trạng thái `SEARCHING` vô hạn. Khách phải tự huỷ, còn worker tiếp tục tốn tài nguyên.

Các ứng dụng đặt xe lớn đều dừng sau vài phút và báo "không tìm thấy tài xế". Phase 2 còn cần điểm kết thúc rõ ràng để nhả tiền giữ trong ví và mã khuyến mãi.

State machine của Trip đã cho phép `SEARCHING → CANCELLED`, và actor `SYSTEM` đã có trong domain.

## Quyết định

- Matching lưu `search_deadline_at = created_at + SEARCH_TIMEOUT_MS` cho mỗi search. Mặc định 180000 ms (3 phút), cấu hình được.
- Worker không tạo offer mới sau deadline. Khi đã quá deadline và không còn offer `PENDING`, Matching đóng search và gọi lệnh huỷ ở Trip với actor `SYSTEM`, lý do `NO_DRIVER_FOUND`. Lệnh có idempotency key theo `tripId`.
- Offer đang chờ lúc chạm deadline vẫn được chạy hết 20 giây. Tài xế accept trong khoảng đó thì chuyến vẫn được gán.
- Trip ghi lịch sử trạng thái, phát `trip.cancelled` với `reason=NO_DRIVER_FOUND`. Gateway đẩy cho khách; app hiển thị "Không tìm thấy tài xế" và nút đặt lại.
- Không thêm trạng thái mới vào Trip.

## Phương án đã cân nhắc

| Phương án | Lý do không chọn |
| --- | --- |
| Trạng thái mới `NO_DRIVER` ở Trip | Phải sửa state machine, API và app; `CANCELLED` + lý do đủ diễn đạt |
| Trip tự hẹn giờ và huỷ | Trip không biết Matching còn offer đang chờ hay không, dễ tranh chấp với accept muộn |
| Mở rộng bán kính theo thời gian | Hay, nhưng là tối ưu; có thể thêm sau trên cùng cơ chế deadline |

## Hệ quả

- Tích cực: không chuyến nào treo vô hạn; có điểm kết thúc cho saga thanh toán và khuyến mãi; có metric `trips_total{reason="NO_DRIVER_FOUND"}`.
- Tiêu cực: thêm một lệnh Matching → Trip cần test tranh chấp với accept ở giây cuối.

## Tiêu chí hoàn thành

- Test tích hợp: không có tài xế → chuyến `CANCELLED` với `NO_DRIVER_FOUND` sau deadline.
- Test tranh chấp: tài xế accept trong cửa sổ offer cuối thì chuyến được gán, không bị huỷ.
- App khách hiển thị đúng thông báo.
