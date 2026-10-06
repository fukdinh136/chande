# Thiết kế frontend Customer và Driver — demo Android

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Customer App / Driver App |
| Rà soát | 2026-10-06 |
| Quy ước | [Format và số liệu](../quy-uoc-tai-lieu.md) |

## Trạng thái thực thi hiện tại

Các mô tả dưới đây là thiết kế đích. Đã triển khai từng phần kết nối trong app/; trạng thái, commit, kiểm thử và giới hạn APK/native được ghi tại [báo cáo thực thi](bao-cao-ket-noi.md). Shared-source Android variants hiện dùng com.chande.customer/com.chande.driver; workspace mobile riêng vẫn là đề xuất.

Hai ứng dụng Android, hai APK/package ID và phiên đăng nhập riêng. Customer role wire là RIDER; Driver là DRIVER. Giữ UI Velox từ folder thực tế [stitch_ride_hailing_customer_app_ui](../../stitch_ride_hailing_customer_app_ui/velox_ride/DESIGN.md). Thiết kế này được triển khai từng phần ở app/; native SDK chưa triển khai và backend đang chạy được giữ nguyên.

Người dùng đã chốt: hai app, MapLibre Navigation SDK, tận dụng API backend và UI Stitch, chức năng chưa có được skip; cập nhật mới nhất chỉ demo Android, bỏ iOS khỏi đợt này. Các cấu trúc workspace, version native, polling/throttle và feature flags dưới đây là đề xuất kỹ thuật để review, chưa phải kết quả chạy app.

| Tài liệu | Nội dung |
| --- | --- |
| [Báo cáo kết nối](bao-cao-ket-noi.md) | Code/commit đã triển khai, smoke backend thật, CI, cách chạy và giới hạn Android/native |
| [Phạm vi và UI](pham-vi-ui.md) | 15 ảnh/14 HTML, giữ/đổi/skip từng màn hình, design tokens, 28 user story |
| [Kiến trúc](kien-truc.md) | Hai app/workspace, component/ports, cache/session, state machine, reuse app hiện tại |
| [API client](api.md) | Public REST, DTO/envelopes, realtime, replay, version và contract façade frontend |
| [MapLibre Navigation](maplibre-navigation.md) | Renderer/native navigation, GPS, route DTO gap, R05 draft và native spike |
| [Kế hoạch và kiểm thử](ke-hoach-va-kiem-thu.md) | Feature nhỏ, Android APK demo, test và điều kiện nghiệm thu |

## Phạm vi chạy được với backend hiện tại

Customer: SĐT/mật khẩu, profile/saved places, pin pickup/destination trên map, estimate CAR_4/CAR_7, quote 5 phút, create/cancel, trạng thái Trip qua /ws và lịch sử. Driver: OTP account đã có, profile/vehicle/selection/ONLINE, GPS foreground, offer 20 giây, accept/decline, Trip progress/cancel và lịch sử. Các client và màn hình cơ bản đã có, nhưng map/native và restyle còn chưa hoàn thành; kết quả backend smoke không thay UI nghiệm thu.

Basemap cần style/tiles/glyphs/sprites có coverage Hà Nội; OSRM không cung cấp chúng. Geocoding chưa có: chọn pin/saved coordinates, không giả autocomplete. Customer chưa nhận GPS Driver: giữ card trạng thái/snapshot và route tham khảo, bỏ xe chạy/ETA đến đón/speed. Thanh toán/promo/rating/chat/push/wallet/income statistics skip.

Driver turn-by-turn bằng MapLibre Navigation là mục tiêu bắt buộc của thiết kế nhưng có gate native. R02 hiện chỉ đủ preview; adapter Routing đã bỏ step geometry/leg structure cần cho SDK. [R05](maplibre-navigation.md) là API bổ sung **DRAFT, chưa tồn tại**; không gọi hoặc khẳng định SDK chạy đầy đủ trước khi spike và contract gate đạt. Nếu gate chưa đạt, bản demo preview phải ghi đúng phạm vi và không được gọi là nghiệm thu navigation.

Backend và các hợp đồng có thẩm quyền: [bảng liên service](../hop-dong-lien-service.md), [runbook](../deploy-backend.md), [Trip](../../service/trip-service/docs/api.md), [User](../../service/user-service/docs/user-service-v2.md), [Driver](../../service/driver-service/docs/api.md), [Matching](../../service/matching-service/docs/api.md), [Routing](../../service/routing-service/docs/api.md). Không sao chép token nội bộ hoặc private config vào app.
