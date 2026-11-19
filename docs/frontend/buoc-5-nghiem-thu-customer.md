# Bước 5/5 — Kiểm chứng Customer Velox

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Customer App / Driver App |
| Rà soát | 2026-11-18 |
| Quy ước | [Format và số liệu](../quy-uoc-tai-lieu.md) |

## Phạm vi và cách đọc kết quả

Đối chiếu [phạm vi UI](pham-vi-ui.md), [API](api.md), [tiến độ](tien-do-customer-velox.md), báo cáo [bước 2](buoc-2-customer-dat-xe.md), [bước 3](buoc-3-vong-doi-chuyen.md), [bước 4](buoc-4-lich-su-tai-khoan.md) với mã hiện tại. Giữ shared-source `app/`, nhận diện Velox/Inter/tiếng Việt, Customer/RIDER và Driver riêng package. Không sửa backend, thêm dependency/endpoint, triển khai iOS hoặc phát hành cửa hàng.

Tách ba loại bằng chứng: unit/component có mock native/network boundary; adapter/store chạy API thật của stack test; APK/UI Android thực tế. Export JS không phải build APK; API pass không phải nghiệm thu bản đồ, cảm biến, bàn phím hoặc TalkBack. Dữ liệu/tọa độ fixture chỉ dùng trong test cô lập, không thêm vào luồng Customer thật.

## Lỗi đã sửa trong bước 5

1. Đăng ký chưa kiểm giới hạn BCrypt 72 byte UTF-8, trong khi đổi mật khẩu đã kiểm và User source yêu cầu. [Password policy](../../app/src/features/customer/password-policy.ts) dùng chung hai form, giữ login theo hợp đồng xác thực tài khoản hiện có. Regression kiểm ranh giới ASCII, chữ có dấu và emoji; không làm yếu validation backend.
2. Phản hồi đăng ký public có thể tiếp tục login sau khi owner thay đổi trong lúc request chờ. [Login](../../app/src/features/customer/login.tsx) chụp owner epoch trước submit và kiểm lại trước login; test chứng minh không thay phiên mới bằng tài khoản của request cũ.
3. Bộ lọc/nhóm tài khoản trước đây chỉ có nhãn “Đang chọn” nhưng chưa expose selected state cho trợ năng. [Action dùng chung](../../app/src/features/ui/components.tsx) hỗ trợ role/selected, Customer dùng role tab; Driver mặc định vẫn là button. Công tắc mặc định địa chỉ có kích thước tối thiểu 48dp trong layout.
4. Header Home có logo/tagline và tên không giới hạn trong vùng cố định; màn nhỏ/chữ lớn có nguy cơ chiếm hết vùng booking. [Home](../../app/src/features/customer/home.tsx) dùng logo gọn khi cần, giới hạn phần chào/trạng thái hai dòng; nội dung chuyến đầy đủ vẫn nằm trong bảng cuộn. [Logo](../../app/src/features/ui/design.tsx) giữ mặc định Driver và các màn khác.
5. Phát hiện trên web thật: mở Lịch sử lúc chưa có chuyến, sau đó đặt/hủy và quay lại vẫn hiện cache rỗng. [History](../../app/src/features/customer/history.tsx) đọc lại khi route được focus; giữ khóa request/cursor và dữ liệu cũ của store. Regression kiểm mở lại sau cache rỗng; không đổi API hoặc tải toàn bộ lịch sử.
6. Splash Customer còn dùng ảnh Expo xanh mặc định từ app.json. [Config variant](../../app/app.config.js) thay riêng Customer bằng icon/màu Velox hiện có; regression đảm bảo cấu hình splash Driver không đổi. Đây là thay đổi native, cần prebuild/build lại; debug build không thay thế kiểm splash release theo [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/splash-screen/).
7. Lỗi tile native chỉ xuất hiện qua LogManager, không qua callback lỗi load style. [Loading errors](../../app/src/features/map/loading-errors.ts) có dispatcher dùng chung, Customer Home/editor opt-in nhận lỗi tile để hiện thông báo Việt + retry sẵn có; giữ marker/input và không xóa thông báo khi style-ready tới sau lỗi tile. Chỉ lỗi tile đã xử lý được thay bằng UI; lỗi khác và Driver mặc định vẫn theo logger gốc. Regression phát sự kiện ở native boundary, kiểm retry/marker và cleanup, không chỉ snapshot. API theo [MapLibre v11](https://maplibre.org/maplibre-react-native/docs/setup/migrations/v11/).
8. Ảnh Android thực tế cho thấy chữ status bar trắng trên nền sáng. [Customer layout](../../app/src/app/customer/_layout.tsx) đặt StatusBar dark riêng trong nhánh Customer bằng module Expo hiện có, không thay layout Driver.

## Môi trường đã kiểm tra

| Thành phần | Kết quả thực tế |
| --- | --- |
| Windows / Node | Node v24.21.0; npm theo lockfile hiện có |
| Docker | Ban đầu daemon tắt; đã khởi động Docker Desktop Linux |
| Backend test | Compose project `chande-driver-verification`, loopback `http://127.0.0.1:18082`, database/Redis/RabbitMQ/volumes riêng. Kiểm name/port/không external volume trước khi up; các service healthy, migration test thành công |
| Backend đang dùng | Image local có sẵn theo harness; nghiệm thu hợp đồng runtime qua API thật. Không khẳng định đã build/test lại toàn bộ source tám service |
| Java Android | Java mặc định là 25; build chọn JDK 17 có sẵn trong cache Gradle, không đổi JAVA_HOME toàn máy |
| SDK / thiết bị | SDK có Android 36/37 và NDK 27.1.12297006; AVD `Medium_Phone_API_37.0` đã boot, adb nhận `emulator-5554`. Trước nghiệm thu chỉ có package `com.chande.driver` |
| Customer native | CNG sinh trong `app/.expo/c5`, copy source/config/assets/modules/plugin và dùng dependency đã cài; không copy env private, không ghi đè `app/android` Driver. Package theo config `com.chande.customer`; kết quả APK/UI cập nhật bên dưới |
| Metro Customer | `127.0.0.1:8083`, APP_VARIANT customer, backend test 18082; adb reverse hai cổng |
| Browser | CUA host không khả dụng; sau đó dùng Chrome DevTools thành công. Chrome 157 trên Windows, preview Customer localhost8081, Gateway test18082 |

Harness và điều kiện test: [runbook Driver](../../service/driver-service/docs/deploy.md#stack-xác-minh-tích-hợp-riêng), [verification-stack](../../service/driver-service/scripts/verification-stack.cjs). Không dùng ingress demo 18080/18081 hoặc production để tạo chuyến nghiệm thu. Không đưa mật khẩu/token/keys vào báo cáo. Tài khoản nghiệm thu mới và thông tin Driver fixture chỉ giữ trong process QA khi điều khiển thiết bị.

## Kiểm tra tự động và build

| Kiểm tra | Pass | Fail | Skip | Phạm vi |
| --- | --- | --- | --- | --- |
| Baseline `npm.cmd test` | 140 | 0 | 5 | Trước sửa bước 5; giữ kết quả lịch sử 145 test |
| `npm.cmd run lint` | 1 | 0 | 0 | Sau bản sửa history/config cuối |
| `npm.cmd run typecheck` | 1 | 0 | 0 | Sau bản sửa history/config cuối |
| Suite đầy đủ với ba cờ live, lần cuối | 149 | 0 | 0 | Sau sửa tile fallback/status bar, gồm hồi quy Driver, source Customer, sáu integration trên 18082; 78506.18 ms |
| Suite mặc định trước regression history cuối | 142 | 0 | 6 | 148 test; 196494.64 ms. Sáu live skip do chưa bật cờ ở lần chạy này; sau đó toàn bộ 149 test đã chạy với live |
| History/config regression cuối | 10 | 0 | 0 | Có kiểm cache rỗng khi mở lại lịch sử và giữ splash Driver |
| Sáu integration riêng | 6 | 0 | 0 | Năm test cũ + một test Customer mới, đều API thật |
| Android APK trước sửa splash | 1 | 0 | 0 | Gradle assembleDebug thành công 52m14s; sửa dev-server IP build tăng dần thành công 4m42s; đã cài/mở `com.chande.customer` |
| Android APK sau sửa splash | 1 | 0 | 0 | `BUILD SUCCESSFUL in 24m47s`, 361 task; đã cài APK cuối thành công. Còn phải kiểm visual splash/UI đầy đủ |
| Gradle rerun xác nhận exit code | 0 | 1 | 0 | Sau build thành công, lượt kiểm lại dừng ở Gradle lock communicator: `java.net.BindException: Address already in use`, trước compile; lỗi môi trường riêng, không xóa kết quả build/APK có thật |
| Customer web export | 1 | 0 | 0 | Expo exit0, static routes/bundles; không thay bằng chứng UI |
| Driver Android export | 1 | 0 | 0 | Hermes bundle5,1MB, lượt xác nhận cuối Expo exit0; không phải Driver APK/device |
| Docs / whitespace | 2 | 0 | 0 | 67 UTF-8 docs, 584 local links, 54 JSON examples, 27 contract checks; diff check đạt, có cảnh báo CRLF hiện có |

[Customer live test](../../app/test/customer-live.test.cjs) dùng chính UserSession, CustomerBookingStore, CustomerDataStore, DurableCommand, TripEvents và API adapters. Nó kiểm register/login/restore, address null label/default/CRUD và snapshot điểm, quote/create, exact-key replay sau mất receipt, Matching assignment, foreground, completion/summary, lọc/detail, rebook đòi quote mới, cancel replay, profile/password/logout/login lại. Backend ghi thật, GPS Driver là fixture tổng hợp; mất receipt được mô phỏng tại adapter **sau POST thật**, không gọi đó là lỗi mạng native đã nghiệm thu.

Test mới chỉ chạy khi `CUSTOMER_APP_INTEGRATION=1`, ACK storage đúng và origin chính xác 18082; guard trước ghi. Suite mặc định sau bổ sung có sáu integration skip. Không bỏ qua hoặc nới checker để đạt; giữ warning deprecation hiện có từ react-test-renderer và warning build upstream.

## Ma trận kịch bản

| Kịch bản | Mức kiểm chứng | Trạng thái | Bằng chứng / giới hạn |
| --- | --- | --- | --- |
| Đăng nhập/đăng ký, validation, bấm lặp | Unit/UI + API thật | Đạt | SĐT, password bytes, field errors, owner cũ; real register/login/password change |
| Ba tab, route detail theo ID, Back/fallback | Component + web | Đạt trong phạm vi | Web mở detail riêng và quay lại; native thấy đủ ba tab, Back toàn bộ route chưa nghiệm thu |
| Hai điểm, Hà Nội không tự xác nhận, marker/nhãn | Component/source | Đạt | Point candidate và confirm riêng, saved label/copy; map native chưa nghiệm thu ở mốc này |
| Bảng hai mức, gesture handle, cuộn/bàn phím/font scale | Component/source | Đạt trong test | Chưa thay cho kiểm tương tác Android |
| GPS xin quyền khi bấm, deny/off/timeout/late response | Unit/component | Đạt | Mock Location boundary; chưa phải cảm biến native |
| Giá chuỗi/server clock, đổi điểm/xe khi đang tải, hết hạn khi background | Unit/component | Đạt | Không chấp nhận quote cũ; API thật lấy quote/route thành công |
| Tạo hai lần, kết quả chưa rõ, khôi phục journal trước lệnh mới | Unit + store/API thật | Đạt | Một key/body; restart store + refresh session; native SecureStore sau force-stop còn kiểm riêng |
| Assignment → arrived → in progress → completed | Store/API thật | Đạt | Driver public API/version thật; WS invalidation và REST thật |
| Hủy xác nhận, timeout/replay, race với driver start | Unit/UI + API thật | Đạt | Race trong unit; hủy/replay và reservation trên backend thật |
| Mất kết nối/WS reconnect, version cũ/event trùng | Unit/UI + WS thật | Đạt theo phạm vi | Giữ snapshot và khóa lệnh mới; transport fault trên native còn kiểm riêng |
| Lịch sử/filter/load more/error/không trùng | Unit/UI + API thật | Đạt | Cursor/filter server; không tự tải toàn bộ, giữ list khi lỗi |
| Detail timeline/breakdown/404/403/network | Unit/UI + API thật | Đạt theo phạm vi | Milestones thực; lỗi quyền/mạng ở boundary tests |
| Đặt lại, draft confirmation, pending/active gate, quote mới | Unit + API thật | Đạt | Không tự POST/quote, không mang giá/key cũ |
| Hồ sơ/avatar fallback, địa chỉ/default/delete confirmation | Unit/UI + API thật | Đạt | Source dùng chung picker; save lỗi giữ form, booking snapshot độc lập |
| Password/logout/account switch/request đang chờ | Unit/UI + API thật | Đạt | Owner fencing, server revoke refresh, login mật khẩu mới thật |
| UI Android thực tế / ảnh / 48dp / contrast / TalkBack | Emulator API37 | Chưa đạt toàn bộ | Đã build/cài/mở/register/login, bảng hai mức và cuộn; còn lỗi tile/debug overlay và cảnh báo linking khi đổi cấu hình thiết bị; chưa nghiệm thu TalkBack/toàn bộ 48dp |
| Web preview tương tác | Chrome + backend test | Đạt một phần | Register/login, chọn tọa độ/xác nhận, đổi tab giữ điểm, quote thật, double click create, cancel/summary/detail, rebook/draft confirmation/quote mới, filter history, profile/address/password/new login |

## Lệnh và cấu hình kiểm tra

Từ root, chỉ với stack test đã được chuẩn bị theo runbook, giữ private config/volumes hiện có:

```powershell
docker compose -f service/driver-service/node_modules/.cache/driver-verification-stack/compose.json up -d --wait --wait-timeout 240
```

Trong `app/`, dùng backend test riêng:

```powershell
$env:APP_BACKEND_URL='http://127.0.0.1:18082'
$env:APP_INTEGRATION='1'
$env:DRIVER_APP_INTEGRATION='1'
$env:CUSTOMER_APP_INTEGRATION='1'
$env:DRIVER_TEST_STORAGE_ACK='ISOLATED_DRIVER_TEST_ONLY'
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
```

Metro Customer đã khởi động bằng lệnh sau; native APK phải được cài đúng package. Dùng adb từ SDK Driver đang dùng nếu chưa có trong PATH:

```powershell
$env:APP_VARIANT='customer'
$env:EXPO_PUBLIC_LOCAL_DEMO='true'
$env:EXPO_PUBLIC_BACKEND_ORIGIN='http://127.0.0.1:18082'
node --dns-result-order=ipv4first node_modules/expo/bin/cli start --dev-client --localhost --port 8083 --max-workers 2
```

Terminal khác:

```powershell
adb -s emulator-5554 reverse tcp:8083 tcp:8083
adb -s emulator-5554 reverse tcp:18082 tcp:18082
```

Emulator có thể dùng 10.0.2.2 hoặc localhost/reverse; máy thật dùng localhost/reverse qua adb, hoặc ingress LAN thật đã cấu hình. Không nhầm cổng Metro với backend, không trỏ Customer vào Driver direct service. Customer ưu tiên Gateway đã lưu trong khu vực development/demo; kiểm lại nếu biến env mới chưa có tác dụng.

Lệnh native đã chạy từ `app/.expo/c5/android`, với JAVA_HOME trỏ JDK 17 và ANDROID_HOME trỏ SDK có sẵn:

```powershell
.\gradlew.bat :app:assembleDebug -PreactNativeDevServerIp=127.0.0.1 -PreactNativeDevServerPort=8083 -PreactNativeArchitectures=x86_64 --max-workers=2 --no-daemon --console=plain
```

Không dùng Expo Go cho MapLibre/native module. Hai APK/package Customer/Driver độc lập; Driver đang cài được giữ. Hai Metro cần hai cổng nếu chạy hai variant cùng lúc. Hai thiết bị/emulator thuận tiện cho nhận chuyến vì Driver GPS chỉ foreground. Hướng dẫn runtime và JDK gốc: [app README](../../app/README.md).

RN 0.86 Gradle mặc định có thể nhúng IP LAN dù Metro dùng localhost: kiểm `app/build/generated/res/resValues/debug/values/gradleResValues.xml` của project CNG. Lần đầu thấy IP LAN, đã build lại với cả IP và port. Sau đó Metro cũ không trả HTTP; chỉ khởi động lại đúng tiến trình Customer8083, bundle Android 2180 module tải thành công. Không đổi Metro/package Driver. Build trên máy này có lúc thiếu RAM và fallback copy thay hardlink C/D, nên chậm; không dùng thời gian build này làm benchmark sản phẩm.

Web preview tương ứng:

```powershell
$env:APP_VARIANT='customer'
$env:EXPO_PUBLIC_LOCAL_DEMO='true'
$env:EXPO_PUBLIC_BACKEND_ORIGIN='http://127.0.0.1:18082'
$env:BROWSER='none'
node --dns-result-order=ipv4first node_modules/expo/bin/cli start --web --localhost --port 8081 --max-workers 2
```

## Thao tác thực tế và giới hạn

Web đã ghi hai chuyến test thật và hủy bằng xác nhận UI. Sau hủy có summary, detail GET theo UUID, timeline thực tế và lịch sử lọc server. Bấm đúp tạo chỉ có một chuyến; đặt lại hỏi thay draft, về chọn xe và phải lấy quote mới (27.460 ₫ / 2,5 km / 5 phút hành trình cho tọa độ fixture). Đã lưu tên mới, thêm địa chỉ đầu tiên tự mặc định, đổi mật khẩu và đăng nhập UI bằng mật khẩu mới. Không chụp mật khẩu/SĐT. Không tạo chuyến production.

Lượt UI không nhận được offer từ fixture Driver dù availability AVAILABLE và GPS ACK thành công; đã hủy các chuyến test, dừng publisher và trả Driver về OFFLINE/xe ban đầu. Không ép ASSIGNED hay sửa backend để tạo bằng chứng. Completion/arrival/in-progress, timeout sau create/cancel và khôi phục journal đạt qua test store/API thật riêng; **chưa đạt luồng hoàn thành xuyên suốt trên hai UI Android**. Cần kiểm tra worker/round/reservation test nếu lặp lại; không suy ra frontend hoặc backend đã lỗi từ việc chưa có offer.

Android đã thao tác đăng ký/đăng nhập bằng bàn phím thật, mở rộng bảng và cuộn trong vùng nội dung. Hệ thống chỉ hỏi quyền vị trí sau khi bấm nút; đã thao tác tắt location và từ chối quyền. Chưa xác nhận đủ thông báo lỗi và tiếp tục manual sau lần deny vì popup/foreground recovery và dev overlay. Không coi thao tác này là GPS pass trọn vẹn. Đổi AVD xuống 360×640dp/fontScale2 gây recreate; bản debug báo nhiều linking container. Chưa xác định là lỗi development runtime hay tái tạo Activity trên API37; cần kiểm lại API36/release và Back/deep link trước nghiệm thu.

Lượt mở APK cuối với Metro chạy riêng đã khôi phục được tài khoản test qua SecureStore, đọc REST định kỳ và tải tile native thành công; thấy rõ cả hai điểm **chưa xác nhận** dù map mở Hà Nội. WebSocket native vẫn hiển thị cảnh báo gián đoạn trong lượt này, REST timestamp tiếp tục cập nhật. Không coi một lần tile thành công là đã nghiệm thu lỗi/retry/mạng bản đồ. Đã trả kích thước/density/font/GPS emulator về giá trị ban đầu; không thay package/storage Driver.

Tile từ nguồn ngoài không tải ổn định trên cả hai nền tảng. Web hiện thông báo Việt + retry, vẫn nhập tọa độ/lấy giá được. Native trước sửa ghi lỗi tile vào LogBox debug, có lúc che CTA; đã thêm fallback riêng ở mã nguồn và kiểm boundary cho lỗi tile (khác lỗi load style), nhưng cần xác nhận lại bản sửa này trên emulator. Không tắt toàn bộ logger, không thêm bản đồ giả hoặc dữ liệu giả vào luồng thật. Cần mạng truy cập được nguồn tile hiện có và kiểm lại retry/native errors; không thể đánh dấu bản đồ Android đạt.

## Ảnh minh chứng

Ảnh từ ứng dụng thật, test Gateway18082, actor tổng hợp, không có token/password/SĐT. Không dùng Stitch/mock để chứng minh backend. Tọa độ là fixture test tại Hà Nội.

| Ảnh | Nền tảng / nội dung |
| --- | --- |
| [Home fallback](../../artifacts/customer-acceptance/2026-11-18/web/01-home-map-error.jpg) | Chrome Windows; tile lỗi, chọn điểm thủ công vẫn khả dụng |
| [Chi tiết chuyến đã hủy](../../artifacts/customer-acceptance/2026-11-18/web/02-cancelled-detail.jpg) | Chrome; chuyến tạo/hủy thật, timeline và giá API |
| [Lịch sử lọc đã hủy](../../artifacts/customer-acceptance/2026-11-18/web/03-history-filter.jpg) | Chrome; hai chuyến test thật, filter server |
| [Địa chỉ đã lưu](../../artifacts/customer-acceptance/2026-11-18/web/04-saved-address.jpg) | Chrome; mặc định từ server, thông báo chặn đổi điểm khi booking chưa reset |
| [Đăng nhập Android](../../artifacts/customer-acceptance/2026-11-18/android/02-after-metro-restart.png) | AVD API37; Customer Velox đã render, chưa nhập mật khẩu |
| [Sau thao tác từ chối GPS](../../artifacts/customer-acceptance/2026-11-18/android/03-gps-denied.png) | AVD; ghi trạng thái thực sau thao tác, không chứng minh đầy đủ GPS fallback |
| [Màn nhỏ/font200%](../../artifacts/customer-acceptance/2026-11-18/android/04-small-font-200.png) | AVD360×640dp; bằng chứng thử đổi cấu hình, không đánh dấu UI đạt |
| [Home Android cuối](../../artifacts/customer-acceptance/2026-11-18/android/07-customer-final-home.png) | AVD API37, 1080×2400/density420/font1; tile thật đã tải, cảnh báo WS/REST fallback; trước sửa màu status bar |
| [Bảng mở rộng Android](../../artifacts/customer-acceptance/2026-11-18/android/08-customer-final-expanded.png) | Cùng thiết bị/backend; hai điểm chưa xác nhận, bảng cuộn và ba tab; trước sửa màu status bar |
| [Đăng nhập Android sau logout](../../artifacts/customer-acceptance/2026-11-18/android/09-customer-login-final.png) | Đã logout UI và sửa status bar dark; SĐT xám là placeholder trong source, không phải tài khoản đã nhập; mật khẩu trống |

Còn cần: main flow hai UI Android với Driver foreground GPS; SecureStore/journal sau force-stop trong chuyến; native network loss/reconnect/WS, GPS deny/off/timeout/late, quote hết hạn background, màn nhỏ/font lớn/keyboard/Back và đo đủ vùng chạm48dp/contrast/TalkBack. Chưa nghiệm thu máy thật, mạng di động, background dài hoặc độ bền phiên nhiều ngày. Không khẳng định mọi trường hợp Android đạt từ source/tests hoặc một APK build thành công. Không làm iOS/store/release signing.

Checklist bàn giao: đối chiếu trạng thái thật hai role; thử form/network retry giữ nội dung; confirm rebook/draft và quote mới; address sửa/xóa không đổi booking; kiểm lại app origin/variant; giữ backend test tách biệt; không reset dữ liệu demo/production.

## Đối chiếu tiêu chí kết thúc

| Tiêu chí | Kết quả |
| --- | --- |
| Đối chiếu đầy đủ phạm vi frontend1–4 | Đạt; bảng kịch bản và tám nhóm lỗi sửa ở trên |
| Tự động / hồi quy Driver | Đạt trong phạm vi unit/component/API/export; không thay hồi quy Driver thiết bị |
| Chạy backend test, build và mở Customer | Đạt riêng từng mức; Gradle rerun bind lỗi được ghi riêng |
| Luồng thật hoàn thành/hủy đến lịch sử/đặt lại | Store/API thật đạt; web hủy/history/detail/rebook đạt; chưa nghiệm thu completion qua hai UI Android |
| Nghiệm thu Android toàn diện | Chưa đạt; GPS/WS native, đổi cấu hình Activity, gesture/map/scroll/Back và TalkBack còn kiểm tiếp |
| Vùng chạm/độ tương phản | Đã sửa Action/Switch/status bar; chưa đo đủ mọi điều khiển. Attribution SDK trong dump có bounds55×55px ở density420 (~21dp), chưa đạt48dp; cần giải pháp native/SDK hoặc attribution tùy biến bảo toàn nguồn bản đồ trước nghiệm thu |
| Cấu hình/ảnh/giới hạn và bàn giao | Đạt trong báo cáo; không có secret, không dùng production/iOS/store |

Metro Customer8083 và stack test18082 được giữ để xem lại; web8081 đã dừng sau logout, có thể mở lại bằng lệnh trên. Đã logout tài khoản QA trên cả web/Android, dừng helper/publisher và khôi phục trạng thái Driver test cùng cấu hình AVD ban đầu. Build/log QA trong `.expo/` chỉ là artifact local, không đưa vào git. Ảnh chọn lọc trong báo cáo là dữ liệu test; ảnh startup/font ghi lỗi phục vụ chẩn đoán, không làm bằng chứng “đạt”.
