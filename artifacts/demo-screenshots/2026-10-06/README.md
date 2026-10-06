# Ảnh màn hình Customer và Driver

Chụp trực tiếp ngày 2026-10-06 từ demo web Expo nối backend Kubernetes Docker Desktop, namespace `chande-local`. Ảnh giữ nguyên nội dung trình duyệt, chưa kiểm chứng Android native.

Mở [gallery](index.html) trong trình duyệt để xem toàn bộ; bấm ảnh để mở ảnh gốc.

| App | Chức năng | Ảnh |
| --- | --- | --- |
| Customer | Bản đồ, điểm đón/đến và tuyến OSRM | [01](01-customer-map-route.jpg) |
| Customer | Chọn Standard/XL, báo giá và xác nhận đặt xe | [02](02-customer-quote-vehicle.jpg) |
| Customer | Hồ sơ tài khoản và địa chỉ yêu thích | [03](03-customer-account-addresses.jpg) |
| Customer | Lịch sử chuyến | [04](04-customer-history.jpg) |
| Customer | Chi tiết chuyến và các mốc trạng thái | [09](09-customer-trip-detail.jpg) |
| Driver | Hồ sơ tài xế | [05](05-driver-profile.jpg) |
| Driver | Quản lý phương tiện và xe đang chọn | [06](06-driver-vehicles.jpg) |
| Driver | Bản đồ và ý định nhận chuyến ONLINE/OFFLINE | [07](07-driver-home-availability.jpg) |
| Driver | Lịch sử các chuyến đã hủy | [08](08-driver-history.jpg) |
| Driver | Lời mời chuyến, trạng thái chưa có lời mời | [10](10-driver-offers.jpg) |

Customer test: `+84911110000` / `VeloxDemo123!`, tên `Khách Demo Velox`, lưu PostgreSQL `user_db.users`, trạng thái `ACTIVE`. Driver trong ảnh là fixture CAR_7 `84900000007`, OTP demo local `123456`, đang OFFLINE.

Giá và tuyến trong ảnh là kết quả API cho các điểm được chọn tại thời điểm chụp. Lịch sử hiển thị dữ liệu demo thật; màn hình lời mời đang không có offer. [Báo cáo rà soát và kiểm thử](../../../docs/bao-cao-demo-kubernetes.md).
