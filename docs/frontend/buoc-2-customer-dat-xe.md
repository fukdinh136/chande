# Bước 2/5 — Trải nghiệm đặt xe trước tạo chuyến

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Customer App / Driver App |
| Rà soát | 2026-11-18 |
| Quy ước | [Format và số liệu](../quy-uoc-tai-lieu.md) |

## Phạm vi và trạng thái

Đã triển khai phần mã nguồn của bước 2 trên nền [bước 1](tien-do-customer-velox.md). Hoàn thiện chọn/xác nhận điểm → chọn xe → xem giá → xác nhận; nút đặt xe cuối tiếp tục gọi luồng tạo chuyến và journal hiện có. Không mở rộng backend, thêm endpoint/thư viện UI, hoặc tái cấu trúc vòng đời tạo/hủy/theo dõi. Không triển khai bước 3–5.

Đây là kết quả lịch sử của bước 2. Cập nhật tiếp theo về tạo/hủy/theo dõi xem [báo cáo bước 3](buoc-3-vong-doi-chuyen.md); không dùng số test hoặc phạm vi lịch sử bên dưới để thay trạng thái hiện tại.

Đã đọc hướng dẫn repo, [phạm vi UI](pham-vi-ui.md), [API frontend](api.md), schema [Trip](../../service/trip-service/src/api/schemas.ts), [Routing](../../service/routing-service/src/domain/models.ts), [Velox tokens](../../stitch_ride_hailing_customer_app_ui/velox_ride/DESIGN.md), HTML/PNG của [Home](../../stitch_ride_hailing_customer_app_ui/home_map/code.html) và [báo giá](../../stitch_ride_hailing_customer_app_ui/route_fare_estimation/code.html). Đối chiếu Expo SDK 57, Location, Gesture Handler 2.x, Reanimated 4 và React Native 0.86; tái sử dụng dependency và test harness đã có.

## Thay đổi chính

| Phần | Hành vi và file |
| --- | --- |
| Bố cục Velox | [Home](../../app/src/features/customer/home.tsx) có header Customer, vùng bản đồ co giãn và bảng dưới. Bảng là sibling của bản đồ: không che marker/controls/attribution bằng lớp phủ. Hà Nội chỉ là camera mở mặc định, không tạo điểm đón |
| Bảng hai mức | [BookingSheet](../../app/src/features/customer/booking-sheet.tsx) dùng Gesture Handler/Reanimated hiện có; kéo chỉ trên thanh nắm, content dùng ScrollView riêng. Có nút thu gọn/mở rộng cho thao tác chạm/accessibility. Safe area, KeyboardAvoidingView, chiều cao theo viewport/font scale, content cuộn ở cả hai mức; không ép chữ vào hàng cao cố định |
| Điểm và validation | [Store](../../app/src/features/customer/booking-store.ts), [policy](../../app/src/features/customer/booking-policy.ts) giữ điểm đã xác nhận riêng với pin tạm, loại điểm đang sửa, nhãn và bước UI. Xác nhận mới cập nhật draft. Nhập tọa độ là cách thủ công bổ sung khi map/GPS không khả dụng; không có geocoding/autocomplete |
| Nhãn/marker | Điểm thủ công ghi “Vị trí đã chọn”, GPS ghi “Vị trí hiện tại”; địa chỉ yêu thích dùng nhãn đã lưu và `addressText` thật. [PointPicker](../../app/src/features/customer/point-picker.tsx) cho mở/nhập tọa độ. Pin tạm có nhãn chưa xác nhận; pickup/destination phân biệt bằng icon, màu và text |
| Địa chỉ đã lưu | [SavedPlaces](../../app/src/features/customer/saved-places.tsx) đọc API User hiện có; loading/error/retry/empty, không dùng fixture. [Account](../../app/src/features/customer/account-screen.tsx) cũng chuyển lựa chọn về pin tạm để xác nhận ở Đặt xe, không bỏ qua bước xác nhận |
| GPS một lần | [Adapter](../../app/src/features/customer/current-location.ts) chỉ xin quyền và gọi `getCurrentPositionAsync` khi bấm nút; không watch, không tự đọc cached GPS hoặc gửi GPS lên backend. Timeout 20 giây cho yêu cầu, có xử lý từ chối/tắt dịch vụ/lỗi/sample cũ. Chọn thủ công vẫn dùng được |
| Phản hồi muộn | Owner/generation/revision và AbortController loại GPS cũ khi đổi loại điểm, chọn thủ công, nhập tọa độ, rời tab/background hoặc đổi phiên. Kết quả GPS chỉ thành pin tạm, không ghi đè điểm đã xác nhận. Quote/preview cũ bị bỏ ngay khi đổi input |
| Xe/báo giá | [BookingForm](../../app/src/features/customer/booking-form.tsx) trình bày bốn bước, radio 4/7 chỗ, giá chuỗi qua formatter cũ, quãng đường và “Thời gian hành trình” từ API. Không có ETA đến đón, xe mẫu hoặc giá giả. Báo giá hết hạn có “Lấy giá mới”; nút tiếp tục/đặt xe bị khóa khi báo giá không còn dùng được |
| Bản đồ dùng chung | [Native map](../../app/src/features/map/ride-map.tsx) và [web preview](../../app/src/features/map/ride-map.web.tsx) có marker tạm, nhãn, fill layout và retry. Retry giữ tọa độ/tuyến. Padding camera Customer có giới hạn theo kích thước viewport, kể cả viewport nhỏ khi bàn phím mở; tham số mới đều tùy chọn để giữ Driver |

Validation theo tọa độ hữu hạn, longitude ±180 và address nếu có phải trim không rỗng/tối đa 500 ký tự. Trip/route schemas hiện nhận latitude ±90; UI giới hạn ±85,0511 để phù hợp phép chiếu bản đồ đã dùng. Không tự thêm yêu cầu khoảng cách tối thiểu hoặc địa chỉ tìm kiếm. Metadata nhãn hiển thị tách khỏi DTO; không gửi `label`, `source` hoặc dữ liệu GPS ngoài schema đến Trip/Routing.

Draft, nhãn, pin tạm, loại xe và mức mở bảng sống trong cùng store theo phiên, được giữ khi đổi tab. Đổi tài khoản tạo store mới. Nguồn active Trip và lệnh chờ vẫn duy nhất ở provider cấp phiên; không tạo journal/socket/active cache mới cho UI.

## Thời gian server và foreground

[Quote decoder](../../app/src/features/backend/clients.ts) giữ thêm `createdAt` của hợp đồng có sẵn. Khi nhận quote, ưu tiên thời gian server từ `Date`; nếu browser không đọc được header thì dùng `createdAt`. Hiện [Gateway CORS](../../service/api-gateway/src/main/java/com/chande/api_gateway/security/CorsConfig.java) không expose `Date`; không sửa Gateway trong bước này.

Đồng hồ quote dùng mốc server và elapsed local/monotonic, tính bù thời gian request theo hướng bảo thủ; không dùng giờ máy làm giờ server và không kéo dài quote khi đồng hồ máy lùi. Nếu không có cả thời gian server lẫn `createdAt` hợp lệ, không cho xác nhận. VND không chuyển sang Number.

Khi background, khóa xác nhận, hủy chờ GPS ở lớp UI và abort quote request. SDK one-shot không hỗ trợ hủy phép đo native đã bắt đầu, nên kết quả muộn bị bỏ; không có watcher GPS. Khi foreground, kiểm expiry ngay và đối soát qua active read hiện có. Nếu active read không cho xác minh thời gian server (bao gồm web không đọc được `Date`), yêu cầu lấy quote mới; không dùng lại quote chưa xác định hạn. Không tự tạo chuyến hoặc tự thay key/body lệnh khi quay lại app.

## Đối chiếu tiêu chí

| Tiêu chí | Trạng thái | Bằng chứng / giới hạn |
| --- | --- | --- |
| Hai điểm có xác nhận, đi tiếp theo schema | Đạt trong unit/UI tests | Pin tạm không tự thành draft; invalid coords/address khóa đi tiếp; saved/GPS/manual đều qua xác nhận |
| Không coi Hà Nội mặc định là điểm đón | Đạt trong tests/source | Draft/candidate ban đầu rỗng; camera fallback không gọi thao tác chọn |
| Không dùng quote cũ/hết hạn | Đạt trong tests | Đổi điểm/xe khi request đang tải, expires trong background, clock skew/rollback, thiếu giờ server và foreground recheck |
| Giữ draft khi đổi tab | Đạt trong tests | Store/session của bước 1 tiếp tục dùng chung; GPS rời tab bị hủy, draft/quote state không tạo lại theo screen |
| Lấy báo giá thật | Chưa kiểm chứng | Probe Gateway local 18080 và 18081 đều không kết nối được; không chạy integration hoặc tự dựng backend |
| Bảng hai mức dùng trên Android thực tế | Chưa nghiệm thu | Đã có gesture/animation và bundle Android pass; `adb devices -l` trả danh sách rỗng |
| Font scale/keyboard/map scroll trên thiết bị | Chưa nghiệm thu | Tests kiểm sizing/pan boundary/padding, không thay nghiệm thu thao tác Android |

## Kiểm tra ngày 2026-11-18

Node `v24.21.0`, lệnh chạy trong `app/` trừ khi ghi khác. Các fixture/mock chỉ ở test, không trong runtime Customer. Giữ nguyên kiểm tra; không disable lint hoặc thay test thật bằng assertion luôn đúng. Có cảnh báo deprecation `react-test-renderer` và warning môi trường màu từ Metro; không phải lỗi ESLint.

| Lệnh / kiểm tra | Kết quả |
| --- | --- |
| `npm.cmd run lint` | Pass, không lỗi/warning ESLint |
| `npm.cmd run typecheck` | Pass |
| `npm.cmd test` | 98 test: 93 pass, 0 fail, 5 integration skip; có hồi quy Driver |
| `node --test test/customer-prebooking.test.cjs test/customer-prebooking-ui.test.cjs test/driver-ui.test.cjs` | 19 pass; xác nhận điểm, quote/GPS muộn, foreground, bốn bước/CTA, sheet sizing/gesture boundary, map retry/padding và Driver UI |
| `APP_VARIANT=customer`; `npm.cmd exec -- expo export --platform android --output-dir .expo/step2-customer-android --max-workers 2` | Pass JS/Hermes bundle |
| `APP_VARIANT=customer`; `npm.cmd exec -- expo export --platform web --output-dir .expo/step2-customer-web --max-workers 2` | Pass static routes và bundle web |
| `APP_VARIANT=driver`; `npm.cmd exec -- expo export --platform android --output-dir .expo/step2-driver-android --max-workers 2` | Pass JS/Hermes bundle hồi quy |
| Từ root: `node scripts/validate-docs.cjs` | Pass: 64 tài liệu UTF-8, 498 link local, 54 JSON examples, 27 contract checks |
| Từ root: `git diff --check` | Pass, không lỗi whitespace |
| Probe `GET /api/v1/trips/active` không token, timeout 2,5 giây ở 127.0.0.1:18080/18081 | Cả hai không kết nối được; không có live quote |
| `adb devices -l` | Đã chạy ngoài sandbox sau khi sandbox báo không tạo được thư mục adb; daemon chạy, danh sách thiết bị rỗng |
| Browser inventory qua công cụ CUA | Không có browser; báo `The browser access host is unavailable`, chưa có screenshot/tương tác web |

Năm live test được skip theo cấu hình mặc định hiện có, không bật `APP_INTEGRATION`: User/Trip, Driver OTP, booking hai role, Driver production adapters và rich-route navigation. Không build APK, cài app, chạy emulator/native GPS hay nghiệm thu thiết bị trong phiên này. Bundle không thay native proof. Export ở `.expo/` được ignore; không sửa `.env.local`, dependency lock, secret hoặc backend.

## Checklist thủ công và điều kiện nghiệm thu

Cần Gateway/backend đang chạy với account test cô lập, tiles/style truy cập được, Android development build tương thích và thiết bị/emulator hiện trong `adb devices`. Cần browser host hoạt động để chụp/kiểm tra preview web. Dùng public origin theo runbook; không đưa service credential vào app.

1. Mở Đặt xe: bản đồ mở ở Hà Nội nhưng cả hai điểm chưa xác nhận. Thu/mở bằng nút và kéo thanh nắm; pan/zoom bản đồ độc lập, cuộn nội dung không kéo bảng. Kiểm attribution và controls ở cả hai mức.
2. Chọn pin điểm đón, xác nhận, rồi điểm đến; thử sửa/dừng sửa. Chọn địa chỉ yêu thích từ bảng và từ Tài khoản: đúng nhãn đã lưu, vẫn cần xác nhận. Mở tọa độ, thử giá trị sai/rỗng, bàn phím, màn hình nhỏ và font 1,5–2 lần.
3. Bấm Vị trí hiện tại: kiểm permission denied/permanent deny, GPS tắt, chờ timeout và retry; manual vẫn dùng được. Trong lúc chờ, chạm map/đổi điểm/chuyển tab/background: kết quả GPS muộn không đổi pin mới hoặc draft cũ.
4. Xác nhận đủ hai điểm, chọn 4/7 chỗ và gọi báo giá thật; kiểm giá VND, quãng đường/thời gian hành trình đúng response. Đổi điểm hoặc loại xe khi request chậm: quote/tuyến cũ không xuất hiện lại.
5. Để hết hạn ở foreground/background, quay lại app/tab; không thể tiếp tục bằng quote cũ, có nút lấy giá mới. Chỉnh đồng hồ máy, thử web không đọc được Date: không kéo dài quote hay bỏ qua xác minh.
6. Tắt mạng/tiles rồi Retry map: giữ điểm/tuyến và các cách chọn khác. Qua đủ bốn bước mới thấy CTA đặt xe; luồng tạo/journal/active hiện có vẫn dùng. Kiểm Driver map/trip/history sau thay đổi shared map.

## Bàn giao bước sau

Tiếp tục từ store/provider hiện có; giữ `candidate` tách điểm xác nhận, nhãn ngoài DTO, `quoteUsable` là chốt trước CTA và `DurableCommand` là nguồn lệnh duy nhất. Không tự ghi đè GPS, không thêm endpoint/geocoding/ETA đến đón/payment/chat/rating/push. Bước 3 chỉ thực hiện khi được giao; các giới hạn live/native phía trên vẫn cần kiểm chứng riêng.
