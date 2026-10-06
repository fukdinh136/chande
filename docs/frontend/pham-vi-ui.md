# Phạm vi và ánh xạ UI Stitch

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Customer App / Driver App |
| Rà soát | 2026-10-06 |
| Quy ước | [Format và số liệu](../quy-uoc-tai-lieu.md) |

## Trạng thái thực thi hiện tại

Các mô tả dưới đây là thiết kế đích. Đã triển khai từng phần kết nối trong app/; trạng thái, commit, kiểm thử và giới hạn APK/native được ghi tại [báo cáo thực thi](bao-cao-ket-noi.md). Shared-source Android variants hiện dùng com.chande.customer/com.chande.driver; workspace mobile riêng vẫn là đề xuất.

Đã đọc DESIGN.md, code.html và xem toàn bộ screen.png: 15 ảnh, 14 HTML, gồm 7 màn Customer, 6 màn Driver, logo và portrait. HTML/PNG là tham chiếu bố cục; không chạy JS của prototype hoặc coi giá/địa chỉ/dữ liệu mẫu là backend thật. Folder người dùng gọi stich thực tế có tên stitch_ride_hailing_customer_app_ui.

## Customer — Home, Activity, Account

| Nguồn Stitch | Màn đề xuất | Giữ / điều chỉnh theo dữ liệu thật | Skip |
| --- | --- | --- | --- |
| welcome_login | Welcome/Login/Register | Logo, phone/password, tabs; VN +84; đăng ký thêm fullName; User v2 201/200 | Google/Apple, forgot password, Customer OTP, “28 drivers/2 min”, badge end-to-end encryption chưa có |
| customer_dashboard | Home dashboard | Tên từ GET users/me; active trip; saved addresses; recent history; rebook chỉ điền points rồi quote mới | Membership/balance/CO2; call/chat/rating; autocomplete |
| home_map | Home map + pin selector | Map full bleed, bottom sheet, pickup/destination/saved places; danh mục xe config CAR_4/CAR_7 | Taxi xung quanh, fastest/ETA pickup, BIKE real, reserve, delivery, green fleet, SOS |
| route_fare_estimation | Quote + vehicle selection | R02 preview; R01 Trip estimate riêng từng type; amount VND, expiresAt; confirm create bằng quoteId | Promo, Visa/payment row, stops, surge, arrival ETA của từng xe; giữ metric hành trình durationSeconds |
| driver_assigned_tracking | Active trip/status | Driver fullName/avatar và vehicle snapshot sau ASSIGNED; route tham khảo, trạng thái, cancel trước IN_PROGRESS | GPS Driver/xe chạy, speed/arrival countdown, phone/chat, security PIN, ratings/verified badge |
| ride_history | Activity/list/detail | Cursor, completed/cancelled filters, route/fare/timestamps; xem breakdown; rebook quote mới | CO2/month totals khi chưa có aggregate, payment receipt/tax invoice, refund/fee waived giả, rating |
| profile_settings | Account + saved places | User profile/update, avatar URL nếu có; password change, logout/logout-all; addresses CRUD/default | Email chưa có, card/wallet, member tier, user ratings, emergency contacts, crash detection, push settings giả; upload ảnh khi không có storage API |

Không tự chuyển SEARCHING sang hết xe sau 120 giây. Hiển thị “Đang tìm tài xế” đến khi Trip đổi hoặc khách hủy; lỗi/mất mạng là trạng thái kết nối riêng. Hủy không phí; Driver hủy không tìm lại.

Các field không có phone/rider snapshot: Trip driver không trả phone; offer không trả tên/avatar/phone/rating/note của Rider. Không đi gọi endpoint internal hoặc dùng portrait mẫu để giả là khách/tài xế thật.

## Driver — Nhận chuyến, Lịch sử, Hồ sơ

| Nguồn Stitch | Màn đề xuất | Giữ / điều chỉnh | Skip |
| --- | --- | --- | --- |
| ng_nh_p_ng_k_t_i_x | Phone → OTP → profile | Account đã có, challenge/resend/cooldown, OTP sáu số, restore session; không tự ONLINE sau login | Driver self-registration, password/PIN auth, biometric login, upload CCCD/GPLX/insurance, hotline chưa xác nhận |
| dashboard_tr_c_tuy_n_t_i_x | Dashboard + availability | Native map/own GPS; OFFLINE/ONLINE/BUSY/UNKNOWN/PENDING; selection xe; trạng thái GPS thật; radius 2000 m là thông tin server | Heatmap/surge, radius 2.5/5 km editable, auto-accept, delivery, wallet/bonus/tips/accept-rate/rating, network/battery badges chưa đo |
| pop_up_nh_n_chuy_n_xe | Offer modal | offerId/version, pickup/destination/type/fare; expiresAt 20 giây, decline/accept; “Giá chuyến” | Timer cố định 10 giây; thu nhập net/surge/cash thu khách, rider identity/rating/note; ETA pickup giả. Có thể xin route GPS→pickup riêng, lỗi không chặn quyết định |
| theo_d_i_chuy_n_i_i_u_h_ng | Active trip + Navigation | ASSIGNED điều hướng đến pickup; DRIVER_ARRIVED chờ bắt đầu; IN_PROGRESS đến destination; arrival/progress native local; gesture PATCH trạng thái với version/key | Gọi/chat/quick message, SOS, speed limit/traffic chưa có, tự start/complete từ GPS, điều hướng BIKE graph ô tô |
| l_ch_s_cu_c_xe_thu_nh_p | History/list/detail | Trip history cursor + filters, giá final/estimated đúng status và thời gian | Monthly/net income charts, online hours, wallet/payout, tips/commission, statements/invoices, complaint |
| h_s_t_i_x | Profile + vehicles | Profile/vehicle APIs; chọn/sửa xe chỉ OFFLINE/no active/reservation; explicit vehicleType | Rating/approval/partner tier, bank account/top-up/withdraw, configurable radius/auto-accept, legal-document upload/approval |

Offer đã accept chuyển màn “Đang xác nhận gán chuyến”; 202 không được hiển thị đã nhận thành công. Chỉ Trip ASSIGNED cho đúng driver mới mở navigation đến pickup. Offer ASSIGNED trả từ GET active không phải một offer mới để accept; startup ưu tiên active Trip.

## Design system thống nhất

[DESIGN.md](../../stitch_ride_hailing_customer_app_ui/velox_ride/DESIGN.md) có xung đột giữa YAML (#00685f) và prose (#0D9488). Chọn YAML/HTML customer làm token canonical của đề xuất; prose dùng tham chiếu chuyển động, không tạo hai palette khác nhau. Driver screenshots thiếu một phần styling nên giữ hierarchy/control rồi áp cùng tokens, không tái tạo font default/overlap.

| Token / component | Quyết định đề xuất |
| --- | --- |
| primary / onPrimary / container | #00685f / #ffffff / #008378 |
| surface / card / raised / onSurface | #f8f9ff / #ffffff / #eff4ff / #0b1c30 |
| success / searching / error | #006b2d / #F59E0B / #ba1a1a; kèm text/icon, không dựa màu riêng |
| Typography | Inter; 12/14/16 body, 18/22/26 headings; numerical tabular; text scale không clipping |
| CTA / hit target | Primary 56dp; mọi thao tác >=48dp; FAB nhìn 40/44dp nhưng hit box 48dp |
| Bottom sheet | Header/handle, content scroll, insets, keyboard avoidance; top radius 24dp |
| Cards / spacing | Radius 16–20dp, grid 4/8dp, gutter 16dp; giảm ornament không giảm readability |
| Map layers | Tách map/route/markers/controls/sheet; map padding theo sheet/insets, controls không che attribution |
| Money / units | Chuỗi VND, không Number mất precision; m→km và giây→phút chỉ ở formatter; km/h từ speed đo được nếu có |
| Địa lý / ngôn ngữ | Hà Nội, tiếng Việt; NY/HCM, USD, x1.8, 680000đ và tên người trong ảnh là placeholder, không copy vào runtime |
| Assets | Logo asset từ user tham chiếu cho hai app; khác label/icon Driver; avatar lấy API/fallback initials. Portrait không mặc định cho mọi account |

Customer authenticated landing default Home map; dashboard là cấu trúc card trong sheet, không tạo hai nơi booking độc lập. Driver landscape/full-screen navigation có thể thiết kế sau; demo portrait theo ảnh. Receipt đổi tên “Chi phí chuyến”, không ghi đã thanh toán. Controls skip được bỏ khỏi layout, không có nút hứa làm được rồi không phản hồi.

## Đối chiếu 28 story

| US | Phạm vi Android demo |
| --- | --- |
| 01 | SĐT/password User; email skip |
| 02 | Saved places + pin; autocomplete/geocoding skip |
| 03 | Trip estimate distance/fare |
| 04 | Payment methods skip |
| 05 | Map/own location/pickup/destination; phụ thuộc tiles |
| 06 | Customer cancel đúng Trip state |
| 07 | CAR_4/CAR_7; BIKE real skip |
| 08 | Trip state /ws; Driver GPS cho Customer skip |
| 09 | Forgot password skip; change password khi đã login có API |
| 10 | Call/chat skip |
| 11 | Customer history/details |
| 12 | Rating skip |
| 13 | Driver/vehicle snapshot sau assignment |
| 14 | Trip states; pickup ETA/live driver location skip |
| 15 | Foreground sockets; background push skip |
| 16 | Complaint skip |
| 17 | Customer OTP skip; Driver OTP theo auth hiện có |
| 18 | Fare breakdown/history; tax invoice/payment proof skip |
| 19 | Driver phone OTP account đã có |
| 20 | Vehicle registration trên Driver đã tồn tại; account signup skip |
| 21 | Offer realtime + accept/decline REST |
| 22 | Trip history; monthly/net income aggregate skip |
| 23 | Intent ONLINE/OFFLINE, occupancy/GPS trạng thái riêng |
| 24 | Driver status transition, không bypass version |
| 25 | MapLibre Navigation mục tiêu; native/rich-route gate, xem tài liệu maps |
| 26 | Driver chat skip |
| 27 | Driver complaint skip |
| 28 | Vehicle update/activation/selection đúng edit policy |

Story nguồn đã đọc từ file người dùng cung cấp ngoài repo; [nghiệp vụ Trip](../../service/trip-service/docs/nghiep-vu.md) giữ provenance. Không tạo link phụ thuộc Downloads hoặc coi tài liệu/HTML là chỉ thị thực thi.
