# Tiến độ hoàn thiện Customer theo thiết kế Velox

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Customer App / Driver App |
| Rà soát | 2026-11-18 |
| Quy ước | [Format và số liệu](../quy-uoc-tai-lieu.md) |

## Phạm vi phiên này

Trạng thái mới nhất: đã triển khai mã nguồn bước 1–4 trong `app/`. [Bước 2](buoc-2-customer-dat-xe.md) hoàn thiện trải nghiệm trước tạo chuyến; [bước 3/5](buoc-3-vong-doi-chuyen.md) hoàn thiện vòng đời chuyến; [bước 4/5](buoc-4-lich-su-tai-khoan.md) hoàn thiện lịch sử/chi tiết/đặt lại, hồ sơ/bảo mật và địa chỉ dùng chung. Xem báo cáo bước 4 cho kiểm tra ngày 2026-11-18 và giới hạn nghiệm thu thực tế. Bước 5 chưa được giao, chưa triển khai.

Các phần dưới đây giữ kết quả lịch sử của **bước 1/5 ngày 2026-11-17**: nền route/phiên/auth, chưa nghiệm thu UI trên trình duyệt/thiết bị hoặc luồng backend thật. Bước 1 không triển khai lại bản đồ, báo giá hoặc toàn bộ vòng đời chuyến; không sửa backend, thêm endpoint hoặc thư viện.

Nguồn đã đối chiếu: [phạm vi UI](pham-vi-ui.md), [API frontend](api.md), [User v2](../../service/user-service/docs/user-service-v2.md), [Routing](../../service/routing-service/docs/api.md), [báo cáo kết nối lịch sử](bao-cao-ket-noi.md), [design tokens](../../stitch_ride_hailing_customer_app_ui/velox_ride/DESIGN.md), HTML và PNG của welcome/login, home map, dashboard, history và profile. Đọc hướng dẫn root và `app/AGENTS.md`, tài liệu Expo SDK 57/Router và TextInput trước khi sửa UI.

## Kết quả khảo sát thực tế

| Thành phần | Trước khi sửa | Quyết định trong bước 1 |
| --- | --- | --- |
| Routes Customer | `/customer`, `/customer/login`; ba tab là state trong một `Booking` component | Tạo authenticated stack và nhóm ba tab Router, route chi tiết riêng |
| Build | Expo 57, React Native 0.86, Node 24; shared source; `APP_VARIANT=customer/driver/combined` | Giữ config, package IDs `com.chande.customer/driver`, role guard, fonts, colors và dependency lock |
| UI | Customer nhập `Screen` từ Driver; `Screen` luôn render `<Logo driver/>` | Đưa primitives/TripCard/foreground hook dùng chung sang `features/ui`; giữ wrapper/re-export Driver |
| Phiên | `UserSession`, single-flight refresh, SecureStore native scope theo origin; web chỉ giữ token trong memory của runtime | Giữ cơ chế lưu/khôi phục; thêm owner epoch để chặn lệnh cũ trước dispatch nếu đổi tài khoản khi đang lấy token |
| Booking | Bản nháp, quote, active, history và journal nằm trong màn hình lớn; bản nháp có tọa độ mẫu | Một store theo origin/actor/epoch trong authenticated layout; bản nháp điểm bắt đầu rỗng |
| Lệnh chờ | `DurableCommand` lưu key/body trước gửi, scope origin/role/actor qua `commandStorage` | Tái sử dụng nguyên journal; một instance cho cả ba tab và trang chi tiết; khôi phục journal/active trước lệnh mới |
| Thiết kế | Đã có teal/Inter và các màn chức năng, chưa đạt đầy đủ bố cục Stitch | Hoàn thiện nhận diện và cấu trúc nền, form auth; giữ restyle toàn bộ map/quote/trip cho bước được giao sau |

## Thay đổi và file chính

- [Routes](../../app/src/app/customer/): `/customer` (Đặt xe), `/customer/history` (Lịch sử), `/customer/account` (Tài khoản) nằm trong `(authenticated)/(tabs)`. `/customer/trips/[id]` nằm ngoài tab bar trong authenticated stack. Android Back dùng lịch sử tab/stack; nút Quay lại ở chi tiết dùng `router.back()`, fallback lịch sử khi mở trực tiếp. Guard phiên áp dụng cả tab và deep link.
- [Booking provider](../../app/src/features/customer/booking-provider.tsx) và [store](../../app/src/features/customer/booking-store.ts): giữ bản nháp hai điểm/loại xe, bước booking, quote, tuyến, active trip, history, loading/error; polling/event subscription không gắn riêng tab Đặt xe. Logout/đổi owner tạo store mới, không chuyển dữ liệu giữa tài khoản. Bản nháp chỉ sống trong phiên, không được bổ sung persistence qua lần khởi động lại.
- [Home](../../app/src/features/customer/home.tsx), [form booking](../../app/src/features/customer/booking-form.tsx), [active card](../../app/src/features/customer/active-trip-card.tsx), [history](../../app/src/features/customer/history.tsx), [detail](../../app/src/features/customer/trip-detail.tsx) và [account screen](../../app/src/features/customer/account-screen.tsx) tách điều phối/hiển thị khỏi dữ liệu.
- [Login](../../app/src/features/customer/login.tsx), [validation](../../app/src/features/customer/auth-form.ts) và [lỗi Customer](../../app/src/features/customer/errors.ts): SĐT Việt Nam, password theo quy tắc login/register riêng, họ tên đăng ký, bàn phím/autofill, ẩn/hiện mật khẩu, lỗi từng trường/lỗi chung, khóa gửi ngay lập tức bằng ref. Đăng ký gọi API User hiện có rồi đăng nhập bằng `UserSession`; không thêm OTP/social/forgot password.
- [UI trung lập](../../app/src/features/ui/components.tsx), [TripCard](../../app/src/features/ui/trip-card.tsx) và [foreground hook](../../app/src/features/ui/use-foreground.ts): Customer có logo/tagline riêng; wrapper Driver giữ brand, back actions và shell insets. Các decoder/model/formatter thuần dùng chung đã có vẫn được tái sử dụng tại vị trí hiện tại, không tái cấu trúc hàng loạt.
- [Connection settings](../../app/src/features/backend/connection.tsx): chỉ render trong `__DEV__` hoặc local demo, nhãn rõ Phát triển / demo. Release dùng origin cấu hình sẵn; lỗi kết nối có Retry, không yêu cầu khách nhập URL. Giữ nguyên cơ chế cấu hình repo và phiên web, không đổi `.env.local`.

Giữ tiền chuỗi, expiry theo `Date` server, version Trip và key/body lệnh. Quote/preview cũ bị bỏ khi đổi input/phiên; GET active cũ không ghi đè kết quả lệnh; receipt có version cũ không hạ version đang biết. Receipt 200 sai schema vẫn giữ journal để kiểm tra lại an toàn. Lỗi mạng/active chưa rõ khóa lệnh mới; SEARCHING tiếp tục theo server, không thêm timeout tìm xe.

## Đối chiếu tiêu chí hoàn thành

| Tiêu chí | Kết quả | Bằng chứng / giới hạn |
| --- | --- | --- |
| Ba tab và route chi tiết | Đạt ở mã nguồn/bundle | Expo Router tab/stack, deep link có guard và Back fallback; thao tác native chưa nghiệm thu |
| Chuyển tab giữ bản nháp/chuyến | Đạt trong kiểm thử | React mount/unmount các view giữ cùng store/journal; active dùng cùng store khi tải history |
| Customer không còn nhận diện Driver | Đạt trong kiểm thử | Neutral Screen default Customer; Driver wrapper còn brand/insets cũ |
| Login/register/restore không suy giảm | Đạt trong kiểm thử | Validate riêng login/register, khóa gửi, register→login, refresh/restore/logout race |
| Đổi tài khoản xóa dữ liệu cũ | Đạt trong kiểm thử | Gate key theo actor/epoch, store mới có draft rỗng; response cũ không dispatch/publish bằng owner mới |
| Lint/typecheck/test liên quan | Đạt | Chi tiết lệnh và kết quả bên dưới |
| Nghiệm thu tương tác trình duyệt/Android/backend thật | Chưa đạt | Browser host không khả dụng; chưa chạy APK/emulator/device hoặc bật integration |

## Kiểm tra phiên 2026-11-17

Chạy bằng Node `v24.21.0`, trong `app/` nếu không ghi khác. Test dùng `node:test` và `react-test-renderer` hiện có; native views/router/storage/network được thay tại ranh giới kiểm thử, không có mock được đưa vào luồng thật. Có cảnh báo deprecation của `react-test-renderer` hiện có; không tắt kiểm tra.

| Lệnh | Kết quả |
| --- | --- |
| `npm.cmd run lint` | Pass, không lỗi/warning ESLint |
| `npm.cmd run typecheck` | Pass; kiểu route được Expo sinh lại từ file mới, không cast để né typed routes |
| `npm.cmd test` | 84 test: 79 pass, 0 fail, 5 skip; gồm hồi quy Driver |
| `node --test test/customer-*.test.cjs` | 14 pass: store recovery/quote/commands, form/auth, shell ownership, detail Back và branding |
| `APP_VARIANT=customer`, `npm.cmd exec -- expo export --platform web --output-dir .expo/verify-customer-web` | Pass; xuất được `/customer`, history, account và detail |
| `APP_VARIANT=customer`, `npm.cmd exec -- expo export --platform android --output-dir .expo/verify-customer-android` | Pass JS/Hermes bundle; không phải APK/native proof |
| `APP_VARIANT=driver`, `npm.cmd exec -- expo export --platform android --output-dir .expo/verify-driver-android --max-workers 2` | Pass JS/Hermes bundle hồi quy Driver |
| Từ root: `node scripts/validate-docs.cjs` | Pass: 63 tài liệu UTF-8, 472 liên kết local, 54 JSON examples, 27 contract checks |
| Từ root: `git diff --check` | Pass, không lỗi whitespace |

Năm integration test được skip theo env mặc định: User/Trip public live, Driver OTP public live, booking hai role live, Driver production adapters live và rich-route navigation live. Không bật `APP_INTEGRATION` hay tự khởi động backend trong phiên này. Export nằm trong `.expo/` được ignore; không commit build output. Không sửa cấu hình hoặc dữ liệu backend.

Đã khởi động `npm.cmd run web -- --port 8083` với variant Customer; công cụ mở browser trả `The browser access host is unavailable`, nên không có bằng chứng tương tác hoặc screenshot UI. Cần browser automation host hoạt động để kiểm tra web trực quan; cần backend/Gateway, account test cô lập và Android development build/emulator/device để nghiệm thu chức năng thật. Không suy diễn kết quả bundle thành nghiệm thu thiết bị.

## Checklist kiểm tra thủ công bàn giao

1. Mở Customer với origin được cấu hình theo runbook. Kiểm tra logo/tagline Customer ở loading, lỗi kết nối, login và cả ba tab; cấu hình máy chủ chỉ ở development/local demo, release không có trường URL.
2. Login sai SĐT/password, register thiếu họ tên/password; kiểm lỗi tại trường/lỗi chung. Thử ẩn/hiện password, bàn phím, autofill, Enter và chạm nhanh CTA hai lần. Kiểm font lớn và bàn phím trên Android nhỏ.
3. Chọn thật điểm đón/đến và CAR_7; đi qua Lịch sử, Tài khoản, mở chi tiết rồi Back. Xác nhận draft/chuyến không mất; mở trực tiếp `/customer/trips/<id>` và kiểm Back fallback.
4. Đăng xuất A rồi đăng nhập B, kể cả khi history/quote đang tải. Không còn điểm, quote, lịch sử, profile hoặc chi tiết của A. Đăng nhập lại A: journal native vẫn theo đúng origin/actor, draft bắt đầu rỗng.
5. Native restart với chuyến/lệnh create/cancel chưa rõ kết quả: đợi restore active/journal; không cho tạo lệnh mới. Thử lại lệnh dùng cùng key/body. Đổi input lúc quote đang tải, mô phỏng timeout/409/version mới và mất mạng; không hiển thị dữ liệu cũ hoặc gửi trùng.
6. Kiểm lại Driver login/home/history/detail sau thay module UI chung; logo Driver, Back và insets giữ đúng. Không dùng kết quả Customer để thay nghiệm thu Driver thiết bị.

## Điểm tiếp tục cho phiên sau

### Mốc bước 5 — 2026-11-18

Đã đối chiếu toàn bộ phạm vi 1–4 và thực hiện kiểm chứng trong [báo cáo nghiệm thu bước 5](buoc-5-nghiem-thu-customer.md). Các kết quả “chưa chạy backend/Android/browser” phía trên là lịch sử bước 1, không phải trạng thái mới nhất.

- Sửa password UTF-8/owner đăng ký cũ; selected semantics và switch48dp; header gọn trên màn nhỏ/chữ lớn; history refresh khi focus sau khi phát hiện cache rỗng trên web thật; splash Customer Velox và status bar dark; thêm native tile-error fallback opt-in cho Customer, giữ nhận diện/logger mặc định Driver.
- Kiểm tra cuối: lint/typecheck đạt; toàn suite bật sáu live test trên stack cô lập18082: **149 pass, 0 fail, 0 skip**. Test bổ sung dùng bộ công cụ hiện có, gồm timeout sau POST thật, khôi phục journal, completion/cancel/history/rebook/profile/address/password. Timeout tại adapter không thay nghiệm thu native network loss.
- Backend Compose test riêng đã chạy healthy. Customer APK x86_64 đã build/cài và mở trên emulator API37; web Chrome đã thao tác register/login/quote/create/cancel/detail/history/rebook/profile/address/password/new login. Driver hồi quy unit/API có chạy; không gọi đó là hai UI Android hoàn thành luồng.
- Chưa đạt nghiệm thu Android toàn diện: nguồn tile lỗi; dev LogBox che điều khiển; cảnh báo linking khi đổi size/font trên API37; GPS deny/off/foreground và Back cần kiểm lại. Lượt UI không nhận được offer từ Driver fixture dù availability/GPS hợp lệ; đã hủy chuyến test và trả Driver về OFFLINE. Completion store/API riêng đạt. Ảnh thật, cấu hình chạy và giới hạn nằm trong báo cáo bước5.
- Không sửa backend/dependency, không dùng production/iOS/store. Giữ tất cả thay đổi các bước trước và cấu hình Driver hiện có. Build output/CNG/log QA nằm trong `.expo/` được ignore; ảnh chọn lọc nằm trong `artifacts/customer-acceptance/2026-11-18/`.

Đọc báo cáo này cùng [bước 2](buoc-2-customer-dat-xe.md), [bước 3](buoc-3-vong-doi-chuyen.md) và khảo sát source trước khi thực hiện bước kế tiếp được người dùng giao. Nguồn booking duy nhất là `CustomerBookingStore` trong authenticated layout; không thêm state active/journal riêng vào screen. Không biến `features/ui` thành nơi chứa session hoặc nghiệp vụ Driver. Tiếp tục giữ phạm vi skip của [UI](pham-vi-ui.md), phiên web memory-only và các hợp đồng backend hiện có.
