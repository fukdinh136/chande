# Báo cáo kết nối frontend với backend

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Customer App / Driver App |
| Rà soát | 2026-10-06 |
| Quy ước | [Format và số liệu](../quy-uoc-tai-lieu.md) |

Đã triển khai các client và màn hình demo trong `app/`, kết nối Gateway của backend hiện có; commit/push theo từng feature nhỏ lên `origin/main`. Báo cáo này ghi kết quả thực thi. Các tài liệu kiến trúc/UI còn mô tả thiết kế đích, không chứng minh MapLibre hoặc hai APK đã nghiệm thu.

## Chức năng đã nối

| Thành phần | Kết nối và hành vi |
| --- | --- |
| Gateway | Phát hiện local Docker18080 rồi Kubernetes18081 trong development bằng response401 có contract Trip; Android dùng10.0.2.2 hoặc localhost qua adb reverse. URL explicit được ưu tiên. Chốt origin trước đăng nhập, không tự đổi cluster khi mất mạng |
| Customer / User | Register/login bằng SĐT/mật khẩu; refresh single-flight, logout; native SecureStore lưu refresh token riêng môi trường/role; sửa họ tên và CRUD/default địa chỉ đã lưu. Client còn cung cấp logout-all/password/avatar; các thao tác này chưa có màn hình riêng |
| Customer / Trip | Quote CAR_4/CAR_7, tạo chuyến, active, hủy trước IN_PROGRESS, lịch sử có cursor và chi tiết. Chọn tọa độ hoặc địa chỉ đã lưu; mẫu tọa độ thuộc Hà Nội và có thể sửa |
| Driver / Driver | Giữ màn hình OTP, hồ sơ, xe/chọn xe, ONLINE/OFFLINE và trạng thái vận hành; bật auto Gateway khi không có config direct cũ; URL Gateway chung explicit ghi đè lựa chọn direct cũ |
| Driver / Matching | Active offer, accept/decline bằng JWT DRIVER; cập nhật từ Socket.IO rồi đọc lại REST. Accept202 hiển thị chờ và chuyển đến active Trip; chỉ Trip ASSIGNED xác nhận nhận cuốc |
| Trip events | `/ws`, gửi auth bằng access token, ping25s, reconnect5s, dừng khi logout/unmount. Event chỉ invalidates GET, không áp payload socket làm trạng thái Trip |
| Realtime GPS | Gateway `/realtime`, Socket.IO WebSocket; publisher foreground10s, payload GPS đo mới, ACK thật; duy trì trong authenticated layout khi chuyển màn hình, dừng khi background/đăng xuất/tắt GPS/OFFLINE |
| Routing / Price | Client preview `/routes` và `/routes/recalculate` đã có. Màn hình quote gọi Trip, Trip gọi Routing + Price thật. Không đưa service credential vào app hoặc gọi matrix/internal public |
| Lệnh có idempotency | Create/cancel/accept/decline lưu key + body trước gửi; timeout/5xx giữ lệnh để replay sau restart; request-in-progress không xóa lệnh; lỗi4xx dứt khoát được trả lại để đọc/review trạng thái. Lệnh được scope theo origin/role/actor |
| Android variants | CNG config `APP_VARIANT=customer` → `com.chande.customer`, `driver` → `com.chande.driver`, scheme riêng và guard entry role. Shared source trong `app/`, chưa chuyển sang workspace mobile đề xuất; combined chỉ để phát triển |

User raw JSON/204 và Node envelope được xử lý riêng. Giá VND giữ decimal string; quote đọc `route.distanceMeters/durationSeconds`, không giả định fields nằm ở root. Giữ giá5 phút, offer20s và SEARCHING không deadline. BIKE thật không hiện trong lựa chọn đặt xe.

GPS dùng socket riêng với offer/trip coordinator trong đợt này. Mỗi publisher chỉ có một timer/socket trong lifecycle của nó; chưa đạt thiết kế đích gom tất cả Socket.IO traffic vào một coordinator. Customer chưa có API live GPS tài xế nên không vẽ xe di chuyển hoặc ETA đến đón giả.

## Kiểm thử và bằng chứng

| Kiểm tra | Kết quả và giới hạn |
| --- | --- |
| TypeScript strict | Pass; kiểm thêm khi bỏ `expo-env.d.ts` generated để tái hiện checkout CI sạch |
| Expo lint | Pass, không lỗi/warning ở source cuối |
| Unit / contract | 11 pass: HTTP/raw/envelope/204/errors, discovery/scopes, quote/offer decoders, route/method/body/key, persistence/replay, storage failure, refresh/logout race, socket cleanup và Android identity/config |
| Live API smoke | 3 pass trên `http://127.0.0.1:18080`: User CRUD/default/delete204; Route OSRM2546m; quote27460VND; create replay/cancel/history; Driver OTP/profile/offer lookup; luồng booking bên dưới |
| Luồng tích hợp booking | CAR_7 fixture: Driver ONLINE + GPS → Routing OSRM Hà Nội → Matching offer → RabbitMQ → Realtime WebSocket → accept202/replay → Trip ASSIGNED → Customer cancel → reservation release. Trip WebSocket auth/event được kiểm tra; cleanup logout và khôi phục ý định/xe fixture |
| CI frontend | [Run ed82e6c](https://github.com/fukdinh136/chande/actions/runs/37402837262) SUCCESS: npm ci, lint, 11 unit pass / 3 live skip, Android bundle và typecheck. Live tests chỉ chạy khi `APP_INTEGRATION=1`; CI này không dựng backend |
| Android bundle | Customer và Driver Metro/Hermes export đều pass. Bundle chứng minh JS compile, không thay APK/native/device test |
| CNG / APK | Customer CNG prebuild pass. Gradle assembleDebug FAIL tại tải NDK27.1.12297006 do ổ C hết dung lượng; chưa có APK, chưa chạy emulator/device. Đã dừng daemon và dọn cache/JDK của lần build lỗi, không xóa project/volume/backend |
| Dependencies | npm audit omit-dev báo30 advisory (19high/11moderate, không critical) trong graph Expo/RN hiện có. Các gợi ý fix major không phù hợp stack đã chốt; chưa dùng force/downgrade. Cần xử lý/đánh giá trước release production |

Các tài khoản smoke Customer được tạo riêng với SĐT ngẫu nhiên, không xóa dữ liệu của người dùng. Chuyến test được hủy; không để offer/reservation active. Test Driver chỉ dùng fixture đã có và chặn nếu fixture đang có chuyến/offer.

## Feature và commit

| Commit | Feature |
| --- | --- |
| a53b220 | Đồng bộ dependency Expo và sửa baseline lint/types |
| dd54b40 | Auto Gateway discovery và HTTP raw/envelope adapter |
| 7feeb64 | Client User/Trip/Matching/Routing đúng public contract |
| 820a9b8 | Quote nested route / decimal-string VND |
| d950861 | Durable command và persistence/replay tests |
| d802de2 | Trip WebSocket và cleanup tests |
| f712627 | Customer refresh/session/logout race |
| 61407ee | Customer login/quote/create/cancel/history |
| 2a59d0e | Driver Matching decisions + realtime Gateway |
| 2fc9291 | GPS foreground giữ qua các màn hình Driver |
| a2de880 | Smoke booking qua backend thật |
| 46406cf | Customer profile / saved addresses |
| 474aa66 | Android package IDs / entry guards / config tests |
| f199069 | CI frontend |
| c248cd5 | Sửa clean-CI Expo ambient types; CI mới pass |
| fcced54 | Ưu tiên shared Gateway explicit |
| 6058de2 | Validate cặp status/accepted của Matching ACK |
| 3b90b90 | Dừng background streams / bỏ active read cũ sau lệnh |
| 0e0c712 | Hướng dẫn frontend/local smoke |
| ebb4354 | Lưu UI Stitch nguồn để review |
| 6e5f46e | Public Gateway/variant config example |
| 1d42a96 | Storage key riêng cho từng actor/origin |
| 57f538b | Đồng bộ profile projection sau sửa hồ sơ |
| ed82e6c | Quote countdown theo Date server / offer expiry do server quyết định |

Xem lịch sử đầy đủ tại [GitHub](https://github.com/fukdinh136/chande/commits/main/). Commit tài liệu/UI nguồn và báo cáo nằm sau các commit code trên.

## Chạy và kiểm tra

Backend đã chạy theo [runbook](../deploy-backend.md). Không cần thay `.env` backend hoặc thêm key vào frontend. Không ghi đè `.env.local` đang có; dùng env phiên shell nếu muốn đổi Gateway.

```powershell
Set-Location app
npm.cmd ci
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
$env:APP_INTEGRATION='1'
$env:APP_BACKEND_URL='http://127.0.0.1:18080'
npm.cmd test
Remove-Item Env:APP_INTEGRATION
```

Mặc định npm test: 11pass, 3skip; bật integration: cả14pass. Integration cần backend local đầy đủ, fixture Driver CAR_4/CAR_7 đang không có chuyến và OTP local123456. Đây là cấu hình demo, không phải cơ chế OTP production.

```powershell
$env:APP_VARIANT='customer' # đổi thành driver cho app tài xế
$env:EXPO_PUBLIC_BACKEND_ORIGIN='http://10.0.2.2:18080'
$env:EXPO_PUBLIC_LOCAL_DEMO='true' # cleartext native chỉ cho local demo
npx.cmd expo start --port 8081
```

Development auto-discovery hoạt động khi không đặt origin; explicit Gateway ưu tiên config direct cũ. Máy thật cần `adb reverse tcp:18080 tcp:18080` và URL localhost. Hai dev builds chạy với Metro/variant đúng tương ứng; không dùng manifest của role khác. Trước build APK cần đủ dung lượng SDK/NDK/Gradle, hoặc chuẩn bị cache ở ổ khác; không tự di chuyển SDK đang dùng. CNG sinh native files, không sửa `android/` bằng tay. Native config cleartext yêu cầu prebuild/rebuild; biến này không biến production HTTP thành hợp lệ: release vẫn cần HTTPS explicit.

## Chưa nghiệm thu

MapLibre renderer/native Navigation, basemap/style Hà Nội, R05 rich route, pin trên map, native turn-by-turn, APK installation và Android e2e còn chưa hoàn thành. Preview client không phải SDK navigation. UI hiện là màn hình chức năng cơ bản, chưa restyle toàn bộ hierarchy/token Stitch, chưa nghiệm thu accessibility/font-scale/device layout. Các tính năng chưa có backend (payment/promo/chat/rating/live Driver GPS cho Customer/push/wallet) tiếp tục skip theo phạm vi đã chốt. Không gọi bản này là hai APK hoặc navigation hoàn chỉnh.
