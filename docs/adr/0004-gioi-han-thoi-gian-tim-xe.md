# ADR-0004: Giới hạn thời gian tìm xe

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Matching, Trip |
| Rà soát | 2026-11-22 |
| Quy ước | [Format và số liệu](../quy-uoc-tai-lieu.md) |

## Trạng thái

**Đã triển khai 2026-11-22 trên nhánh `perf/adr-0008-trip-outbox`, chờ nhóm duyệt.** Phase 1, cải tiến P1.2 trong [Kiến trúc mục tiêu](../kien-truc-muc-tieu.md). Kết quả kiểm chứng ở [mục Triển khai](#triển-khai-2026-11-22).

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

## Triển khai (2026-11-22)

| Phần | Thay đổi |
| --- | --- |
| Matching | `Commands.search` lưu `deadlineAt` trong dữ liệu search (không cần migration). `SearchTimeout` ([timeout.ts](../../service/matching-service/src/application/timeout.ts)) chạy khi search quá hạn và không còn offer chờ: cố định `timeoutEventId` trong cùng transaction, gọi Trip, đọc lại trạng thái Trip rồi đóng search. Lỗi mạng thì job thử lại với cùng khoá; Trip trả 409 (khách đã huỷ trước) thì đóng theo trạng thái Trip. Search lưu trước ADR này tính hạn từ lúc đặt chuyến. Lần tìm lại đầu tiên không muộn hơn hạn chót. Metric `matching_search_timeouts{outcome}` |
| Trip | `POST /internal/trips/:id/no-driver-found` (token callback của Matching), idempotent theo `eventId` qua inbox như assignment. Chỉ từ `SEARCHING`; chuyến đã gán trả 409 `TRIP_NOT_SEARCHING`. `cancellation = {actorType: SYSTEM, actorId: null, reason: NO_DRIVER_FOUND}`; ghi lệnh huỷ cho Matching và `trip.cancelled` như mọi lần huỷ |
| App khách | Khi chuyến đang mở biến khỏi `/trips/active`, app đọc trạng thái cuối một lần; nếu là `NO_DRIVER_FOUND` thì hiện "Không tìm thấy tài xế gần bạn" và nút "Đặt lại chuyến" thay vì lặng lẽ quay về màn hình đặt xe |
| Cấu hình | `SEARCH_TIMEOUT_MS` (mặc định 180000), đặt cùng giá trị cho matching-api và matching-worker |

Khác với bản đề xuất: Matching không có trạng thái search mới; search vẫn `SEARCHING` cho tới khi Trip xác nhận, nên không bao giờ đóng một search mà Trip còn đang tìm.

| Tiêu chí | Kết quả 2026-11-22 |
| --- | --- |
| Không có tài xế → `CANCELLED` với `NO_DRIVER_FOUND` sau deadline | Đạt. Test tích hợp Matching ([timeout.test.ts](../../service/matching-service/test/integration/timeout.test.ts)) và Trip ([assignment.test.ts](../../service/trip-service/test/integration/assignment.test.ts)). Trên stack Docker Compose với `SEARCH_TIMEOUT_MS=20000`: chuyến bị huỷ sau 20 giây, khách nhận `trip.cancelled` qua `/ws` |
| Accept trong cửa sổ offer cuối thì chuyến vẫn được gán | Đạt (test tích hợp: offer tạo trước hạn, tới sau hạn vẫn nhận được, search chuyển `ASSIGNMENT_PENDING`, không có lệnh huỷ) |
| App khách hiển thị đúng thông báo | Typecheck và lint đạt; chưa thử trên thiết bị |
| Chuyến cũ treo | Khi triển khai, một chuyến `SEARCHING` từ ngày 2026-11-05 trong DB local được huỷ `NO_DRIVER_FOUND` vài giây sau khi Matching mới khởi động |
