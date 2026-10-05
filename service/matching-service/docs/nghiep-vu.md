# Nghiệp vụ Matching v1

## Quyết định đã xác nhận

- Routing lấy GPS qua Realtime, trả matrix trong bán kính 2 km. Matching gửi pickup và vehicleType, không gửi candidates.
- BIKE, CAR_4, CAR_7. CAR dùng OSRM Hà Nội; BIKE dùng mock đến khi có profile xe máy đã kiểm chứng.
- Xếp theo ETA, khoảng cách đường đi, driverId. Bỏ NO_ROUTE, GPS quá 30 giây, tương lai quá 5 giây, sai loại xe, offline/busy, đã mời hoặc đang bị giữ chỗ.
- Mỗi chuyến một offer chờ; mỗi driver một reservation. Offer hết hạn sau 20 giây kể từ thời gian tạo ở server, không gia hạn khi retry/reconnect.
- Đã decline hoặc hết hạn không mời lại trong cùng chuyến. Hết ứng viên vẫn SEARCHING và kiểm tra lại sau 5 giây; không có deadline tìm xe.
- WebSocket giao offer; JWT DRIVER và Idempotency-Key bảo vệ REST accept/decline. Snapshot lấy từ Driver, không nhận từ app.
- Accept trước expiresAt → ASSIGNMENT_PENDING, chưa phải Trip ASSIGNED. Giữ reservation khi callback chưa rõ kết quả. Callback retry cùng eventId và payload đã đóng băng.
- Cancel/completion là terminal, kể cả đến trước search. Không mở lại khi nhận command hoặc ACK cũ. Assignment giữ reservation đến cancel/completion.
- Trip sở hữu vòng đời chuyến, giá đã chốt và quyền hủy. Matching không đổi giá hoặc tự hủy Trip.

## Trạng thái

Search: SEARCHING → ASSIGNMENT_PENDING → ASSIGNED; mọi trạng thái → CANCELLED/COMPLETED theo Trip. Assignment bị từ chối và Trip còn SEARCHING thì tìm tiếp.

Offer: PENDING → DECLINED/EXPIRED/ASSIGNMENT_PENDING/REVOKED; ASSIGNMENT_PENDING → ASSIGNED/REJECTED/REVOKED; ASSIGNED → REVOKED khi Trip kết thúc. Các trạng thái đóng không mở lại.

## Ranh giới

Driver sở hữu eligibility và projection availability dựa trên ý định online, hồ sơ/xe, active Trip và Matching reservation. GPS không chứng minh tài xế rảnh. RabbitMQ confirm không chứng minh app đã nhận; app phải deduplicate offerId/version. Dependency lỗi không suy ra AVAILABLE.
