# Chạy và vận hành Driver

| Thuộc tính | Giá trị |
| --- | --- |
| Service | driver-service |
| Rà soát | 2026-10-06 |
| Quy ước | [Format và số liệu](../../../docs/quy-uoc-tai-lieu.md) |

Hướng dẫn chạy trực tiếp từ repository; không cần Gateway demo. [API](api.md), [Routes](routes.md), [Kiến trúc](kien-truc.md). Các bước runtime và kiểm thử storage cần môi trường riêng; không tạo schema phỏng đoán từ ERD.

## 1. Điều kiện

Node.js và dependency theo [package.json](../package.json)/[package-lock.json](../package-lock.json); PostgreSQL Driver có schema/tài khoản hợp lệ; Redis Driver; Trip API có trust JWT DRIVER đúng issuer/audience/JWKS. Realtime là service riêng cho GPS.

Driver port mặc định 3003; Trip sample port 3001 và worker 3002. Các port là cấu hình local, không phải contract production. Trip mock issuer có thể dùng 3003 và xung đột Driver; không chạy cùng port hoặc dùng mock JWT thay Driver JWT.

DDL Driver có thẩm quyền chưa nằm trong repository. Trước khi dùng database, owner cần xác nhận type/nullable/default/unique/FK/CHECK và drivers.status ONLINE/OFFLINE. Startup inspector chỉ đọc một phần metadata và DISTINCT status. Legacy PENDING/ACTIVE/BLOCKED chặn startup/hoạt động; không tự chuyển dữ liệu. BLOCKED cần chính sách khóa account trước khi chuyển.

Driver luôn synchronize:false, migrationsRun:false, installExtensions:false; không có script migration/seed/reset. Không chạy migration Trip trên Driver DB, không kết nối trip_db từ Driver.

## 2. Cài và cấu hình

Từ root repository, terminal riêng cho Driver:

```powershell
Set-Location service/driver-service
npm.cmd ci
```

```powershell
if (-not (Test-Path -LiteralPath '.env')) {
  Copy-Item -LiteralPath '.env.example' -Destination '.env'
}
```

Điền cấu hình private; không ghi credential thật vào repository hoặc app. [Sample mặc định](../.env.example) dùng Trip direct local; [sample host khác](../driver-direct.env.example) dùng placeholder. Không ghi đè .env đang có. Biến environment terminal ưu tiên hơn dotenv; kiểm lại giá trị cũ mà không in secret.

| Biến | Default / yêu cầu |
| --- | --- |
| NODE_ENV | development local; production cấm OTP mock |
| PORT | 3003 |
| DATABASE_URL, REDIS_URL | Bắt buộc, chỉ Driver storage được phép dùng |
| DATABASE_TIMEOUT_MS | 5000; tối đa 60000, connect/query |
| DRIVER_LOCK_WAIT_MS | 10000; tối đa 60000, acquire advisory lock, không gồm FIFO local |
| DRIVER_STATUS_MODE | intent hoặc bỏ trống; mode account bị từ chối |
| AUTH_JWT_ISSUER | Bắt buộc, khớp claim chính xác |
| AUTH_JWT_AUDIENCES | driver-service,trip-service,realtime-service,matching-service; bắt buộc có driver-service |
| AUTH_SIGNING_KEY_FILE | Private RSA PEM; bắt buộc production, không đưa vào Git |
| AUTH_KEY_ID | driver-local mặc định; dev không key file sinh key/kid mới sau restart |
| ACCESS_TOKEN_TTL_SECONDS | 900 |
| REFRESH_TOKEN_TTL_SECONDS | 2592000 |
| OTP_MODE | mock local hoặc provider |
| OTP_MOCK_CODE | Tự đặt sáu chữ số local, không trả/log |
| OTP_TTL_SECONDS, OTP_RESEND_SECONDS, OTP_MAX_ATTEMPTS | 300 / 60 / 5 |
| OTP_PROVIDER_CONTRACT_CONFIRMED | true mới cho phép provider |
| OTP_PROVIDER_URL, OTP_PROVIDER_TOKEN | Bắt buộc provider; contract local cần xác nhận |
| TRIP_MODE | real; mock bị từ chối vì không có Trip mock adapter |
| TRIP_BASE_URL | Origin/base path thật phục vụ /trips/active; sample http://127.0.0.1:3001 |
| HTTP_TIMEOUT_MS | 5000 |
| MATCHING_INBOUND_TOKEN | Bắt buộc, server-only |
| REALTIME_INBOUND_TOKEN | Optional; bật batch bằng credential riêng >=32 ký tự, khác Matching token |
| TRIP_LOOKUP_TOKEN | Credential riêng gọi batch active-driver Trip; bắt buộc khi bật đối soát occupancy |
| MATCHING_LOOKUP_TOKEN, MATCHING_BASE_URL | Credential và origin Matching cho batch reservation; cấu hình cùng TRIP_LOOKUP_TOKEN |
| SUPPORTED_VEHICLE_TYPES | BIKE,CAR_4,CAR_7 |
| MAX_VEHICLES | 20 |
| GATEWAY_PROXY_TOKEN | Optional trusted official proxy, để trống cho direct |

Các secret qua helper có thể dùng NAME_FILE, gồm DATABASE_URL/REDIS_URL/issuer/tokens. Private signing key chỉ đọc qua AUTH_SIGNING_KEY_FILE. Không dùng cùng credential Matching/Realtime/Routing, không đưa server secret vào EXPO_PUBLIC_*.

## 3. Chạy và health

```powershell
npm.cmd run start:dev
```

Không watch; thay source/config cần restart có chủ đích. Không dùng dist cũ để kiểm source mới.

| Request | Kết quả |
| --- | --- |
| GET http://localhost:3003/health/live | {status:ok} |
| GET http://localhost:3003/health/ready | 200 ready hoặc 503 not_ready; kiểm DB/schema |
| GET http://localhost:3003/.well-known/jwks.json | Public JWK, không private key |

Ready không kiểm Redis/Trip/provider hoặc chứng minh compatibility đầy đủ. Web app cần ingress/CORS được xác nhận; main.ts Driver hiện chưa cấu hình CORS. Mobile native không dùng CORS của browser. Không dùng Gateway demo để che lỗi cấu hình.

Build và chạy bản compile:

```powershell
npm.cmd run build
```

```powershell
npm.cmd run start
```

Dockerfile build context service/driver-service (từ root: docker build -f service/driver-service/Dockerfile service/driver-service). Chưa có deployment/ingress chung; Dockerfile không tự tạo database/schema.

## 4. Trust Trip và Realtime

Driver HttpTripActive chuyển Authorization người dùng vào GET TRIP_BASE_URL/trips/active. Trip hỗ trợ verifier Driver riêng qua DRIVER_AUTH_JWKS_URL/DRIVER_AUTH_JWT_ISSUER, audience trip-service; không đổi verifier RIDER. HttpOccupancy dùng credential riêng cho POST /internal/trips/active-drivers/batch và POST /internal/matching/reservations/batch, không gửi JWT người dùng vào các batch nội bộ.

Realtime: AUTH_JWKS_URL/issuer tương tự, audience realtime-service; DRIVER_ELIGIBILITY_TOKEN bằng REALTIME_INBOUND_TOKEN, khác ROUTING_INBOUND_TOKEN. [Deploy Realtime](../../realtime-service/docs/deploy.md) có GPS/nearby/CLI và điều kiện riêng.

Driver đã đối soát active Trip và reservation Matching để project AVAILABLE/BUSY/OFFLINE trong Redis do Driver sở hữu. Dependency lỗi project UNKNOWN hoặc trả lỗi; GPS mới/ONLINE không tự AVAILABLE. Cả API availability và quyền đổi xe đọc occupancy; không HSET từ Matching hoặc suy ra hết chuyến từ TTL. [Stack Matching Hà Nội](../../matching-service/docs/deploy.md) đã kiểm chứng BUSY khi giữ offer, AVAILABLE sau terminal với database fixture riêng; không thay thế xác nhận schema production.

## 5. App Driver

Từ root repository ở terminal khác:

```powershell
Set-Location app
```

expo-location/socket.io-client được khai báo trong package.json nhưng chưa có trong lockfile hiện tại. Không dùng npm ci cho trạng thái chưa đồng bộ này. Cài và cập nhật có chủ đích bằng Expo theo SDK đang dùng, rồi review package.json/package-lock.json:

```powershell
npx.cmd expo install expo-location socket.io-client
```

Sau khi package/lockfile đã đồng bộ, các máy khác dùng npm.cmd ci. Nếu clone mới chưa có Expo CLI/dependency, bootstrap bằng npm.cmd install trước, rồi xác minh phiên bản bằng Expo. Các lệnh cài cần mạng và có thay đổi lockfile; review riêng với thay đổi app đã có.

Thêm giá trị từ [driver.env.example](../../../app/driver.env.example) và [realtime.env.example](../../../app/realtime.env.example) vào private env app. Chọn `EXPO_PUBLIC_DRIVER_HTTP_MODE=direct` để Driver HTTP độc lập với Gateway đã lưu của Customer. Driver dùng origin không kèm path (port mặc định 3003); Trip và Matching có origin riêng. Realtime dùng cổng public của deployment (stack local hiện dùng 3006 nội bộ), namespace `/realtime`, transport path `/socket.io/`. Thiết bị thật dùng IP LAN/HTTPS public; Android emulator thường dùng 10.0.2.2, localhost chỉ cho cùng máy hoặc adb reverse. Release yêu cầu HTTPS.

Trip URL và `EXPO_PUBLIC_DRIVER_TRIP_TRUST_CONFIRMED=true` chỉ đặt sau khi issuer/JWKS/audience liên thông đã xác nhận: Driver phát audience `trip-service`, Trip cấu hình `DRIVER_AUTH_JWKS_URL`/`DRIVER_AUTH_JWT_ISSUER` và xác minh role DRIVER. Cờ này bắt buộc cả khi Gateway được discovery; nếu thiếu, TripClient và thao tác nhận chuyến mới bị khóa. Không đưa JWKS private key hoặc service token vào `EXPO_PUBLIC_*`.

Gateway mode cần `EXPO_PUBLIC_DRIVER_GATEWAY_CONTRACT_CONFIRMED=true`. Origin ưu tiên biến Driver Gateway, sau đó địa chỉ đã lưu/BACKEND_ORIGIN; khi không có origin mới discovery các ingress local đã biết trong development. Prefix mặc định `/api/v1` (giá trị trống cũng dùng mặc định); origin có suffix prefix được chuẩn hóa một lần. Các override path là COMPLETE path. Không dùng Gateway demo ở thư mục gốc.

Matching dùng public `/matching/offers/active`, `/matching/offers/:offerId` và `/:offerId/accept|decline` với Driver JWT (audience `matching-service`), không phải endpoint nội bộ. Accept/decline có body `{}` và UUID `Idempotency-Key`; version chỉ là metadata của snapshot, không gửi trong body. Trong direct mode đặt `EXPO_PUBLIC_DRIVER_MATCHING_BASE_URL`; prefix để trống cho service trực tiếp, hoặc đặt `EXPO_PUBLIC_DRIVER_MATCHING_PREFIX=/api/v1` cho ingress public. Gateway mode mặc định dùng Gateway + prefix. Offer chỉ xuất hiện khi Matching API/worker và các dependency Trip/Routing thật đang hoạt động; Realtime giúp cập nhật nhanh, REST polling vẫn hoạt động độc lập. App không tự tạo offer.

GPS/offer Socket.IO cần `EXPO_PUBLIC_DRIVER_REALTIME_BASE_URL`, hoặc gateway mode xác nhận ingress proxy Socket.IO bằng `EXPO_PUBLIC_DRIVER_GATEWAY_REALTIME_CONFIRMED=true`. Java Gateway HTTP riêng không tự cung cấp namespace Realtime. JWT cần audience `realtime-service`. GPS và offer dùng chung một connection theo runtime/owner tới origin này, namespace `/realtime`, path `/socket.io/`; từng consumer giữ lease, dừng GPS không ngắt offer. Thông báo Trip dùng public Gateway `/ws` riêng vì khác giao thức: gateway mode lấy cùng origin, direct mode có thể đặt `EXPO_PUBLIC_DRIVER_TRIP_EVENTS_BASE_URL` + Gateway confirmation; REST polling vẫn độc lập với WebSocket.

Connection Driver chỉ giữ khi có consumer foreground. Listener đăng ký một lần mỗi socket; reconnect không thêm listener. Transport retry có backoff tới 30 giây; lỗi xác thực dừng tự retry, chờ phiên/token mới hoặc thao tác thử lại sau khi kiểm tra cấu hình. Token lấy qua SessionManager; thay access token đóng connection cũ và xác thực connection mới theo cùng owner, không có refresh loop riêng. `/ws` có hạn chờ handshake 15 giây, ping/pong và kiểm tra owner/run; event chỉ invalidates REST, không ghi đè Trip. Logout/đổi owner dừng connection và bỏ callback/ACK cũ ngay.

GPS foreground có một controller/watcher trong authenticated shell. Công tắc GPS bật đo cho bản đồ kể cả khi chưa cấu hình Realtime hoặc đang OFFLINE; publisher chỉ gửi khi ONLINE/có xe đã chọn hoặc còn active Trip ASSIGNED/DRIVER_ARRIVED/IN_PROGRESS. OFFLINE không dừng GPS của chuyến đang chạy. Active Trip/availability dùng resource phiên hiện có; khi lần đọc mới lỗi, card đánh dấu đang dùng dữ liệu lần đọc trước. Realtime lưu GPS theo JWT Driver độc lập với intent; truy vấn nearby vẫn lọc eligibility, ACK không xác nhận AVAILABLE hoặc assignment.

Controller thuộc runtime Driver, chỉ kích hoạt resource trong authenticated shell. Tạm mất khả năng dùng phiên giữ ý định bật GPS để phục hồi cùng owner; logout/đổi owner xóa ý định và mẫu/ACK của owner cũ ngay qua subscription SessionManager. Không khởi tạo watcher/socket ở Login/OTP. Card hiển thị timestamp lịch sử khi định vị tạm dừng, không giữ bộ đếm tuổi dữ liệu bị đóng băng như trạng thái còn mới.

Watcher ưu tiên cập nhật nhanh (`timeInterval=1000` trên Android, `distanceInterval=0`) cho bản đồ/navigation; publisher lấy mẫu mới nhất hợp lệ, mục tiêu 10 giây/lần. Khi watcher không có phép đo mới trong 10 giây (kể cả đứng yên), controller xin một current fix thật; tối đa một one-shot đang chạy, không sửa timestamp mẫu cũ. Expo one-shot không có abort trong API đang dùng: kết quả sau cleanup bị bỏ qua, không khởi tạo thêm request chồng trong Driver. Permission/services kiểm lại khi foreground và mỗi 5 giây lúc chạy; mất quyền/tắt định vị dừng watcher/publisher, trả lease socket và yêu cầu bật lại/thử lại GPS. Offer có thể vẫn giữ connection khi foreground.

Ngưỡng public trong `realtime.env.example` phải khớp deployment: `EXPO_PUBLIC_DRIVER_GPS_FRESHNESS_MS=30000`, `EXPO_PUBLIC_DRIVER_GPS_MAX_ACCURACY_METERS=100`, `EXPO_PUBLIC_DRIVER_GPS_MAX_FUTURE_MS=5000` tương ứng `LOCATION_FRESHNESS_MS`, `LOCATION_MAX_ACCURACY_METERS`, `LOCATION_MAX_FUTURE_MS`. Tọa độ dùng giới hạn Redis GEO ±85.05112878/±180. Mẫu thiếu accuracy, quá ngưỡng, stale hoặc future không gửi. Tuổi ACK tính từ recordedAt/receivedAt, không làm mới từ lúc ACK tới. Socket dùng volatile emit, không backlog/replay GPS cũ; timeout chỉ chờ lần đo mới. Kết nối/ACK có guard theo instance/run; token lấy qua SessionManager, lỗi auth không tạo refresh loop riêng hoặc đổi intent OFFLINE.

Navigation luôn dùng public Gateway `/api/v1/routes/navigation` (hoặc prefix đã xác nhận). Direct Driver mode có thể đặt `EXPO_PUBLIC_DRIVER_ROUTING_GATEWAY_BASE_URL` + Gateway confirmation. Routing trực tiếp yêu cầu `X-Service-Token` scope gateway; credential do Gateway giữ và inject, không đưa vào app, không gửi route này tới Driver.

Active Trip dùng navigation adapter riêng của Driver, không thay implementation map/location store/native module chung. Navigation thuộc màn hình: chỉ chạy khi focus, foreground và Trip đã được đọc thành công. Scope gồm owner, tripId, phase đón/trả, đích và request; đổi scope, mất GPS hợp lệ, lỗi Routing hoặc mất focus xóa line/progress, abort request và dừng native owner. Timer chỉ theo dõi độ mới GPS; không polling Routing vì thiếu SDK hoặc lỗi API. Reroute do offRoute/thao tác người dùng có khoảng cách request tối thiểu 5 giây.

Tuyến Routing được decode/kiểm geometry precision 6 và giữ preview trước khi khởi tạo native. Module hiện chỉ khai báo Android; iOS/bản cài thiếu module chỉ có preview nếu MapLibre/map và Routing khả dụng. Native start lỗi/false giữ preview và thông báo, không giả tiến độ turn-by-turn. Phiên native có ID riêng cho từng tuyến; feed điểm GPS mới trước start để thay replay point cũ. Cần development build có MapLibre và module Android để xác minh native; source/typecheck không nghiệm thu map, permission hoặc SDK trên thiết bị. Chưa bật background location/native navigation iOS.

Thiếu/sai cấu hình optional chỉ khóa capability tương ứng và hiển thị lý do. “Đã cấu hình” không chứng minh service đang hoạt động: Home hiển thị lỗi REST, trạng thái kết nối thông báo và nút thử lại riêng; lỗi dependency/network không được coi là danh sách trống.

```powershell
npm.cmd run start
```

Driver: OTP → Home `/driver` → hồ sơ → phương tiện → chọn xe khi OFFLINE/no active Trip → ONLINE → Bật GPS foreground. Home và mọi route Driver sau đăng nhập nằm trong cùng authenticated shell: một GPS publisher, một OffersProvider/subscription, một bộ availability/active Trip. Đổi tab không khởi tạo lại các resource này. Login/OTP không mount resource phiên.

GET resource của Driver nằm trong store authenticated shell, scope theo runtime/cấu hình backend, driver và owner epoch. Availability (10 giây) và active Trip (`EXPO_PUBLIC_DRIVER_TRIP_POLL_MS`) giữ một polling loop mỗi resource khi foreground; Home, offer và Trip đọc cùng snapshot. Profile/vehicles dùng chung resource; history theo cursor/limit 20, detail theo tripId, chỉ tải khi màn hình focus và foreground. Consumer mới nối vào GET đang chạy; invalidation từ event/thao tác trong lúc GET chạy chỉ giữ một lượt đọc tiếp, bỏ response cũ qua revision. Lỗi đọc giữ dữ liệu lần trước kèm error; không biến lỗi thành danh sách trống. Polling lỗi có backoff tối đa 60 giây. Cache query giữ tối đa 20 entry không còn consumer (entry đang được subscribe không bị đẩy ra); cache Trip terminal có giới hạn riêng. Resource dừng request/timer khi không còn lease, xóa state khi phiên mất khả năng sử dụng hoặc đổi owner; journal command vẫn giữ để đối soát. Driver dùng một AppState listener chung; hook Customer hiện có giữ nguyên hành vi.

Command Trip có khóa SecureStore theo hash môi trường/route auth và command Trip + driverId. Record cũ chỉ chuyển sang khóa mới nếu scope khớp và đang dùng route mặc định đã biết; route tùy chỉnh không được replay record cũ thiếu endpoint. Record khác môi trường được giữ nguyên. Dấu command=null ngăn record cũ đã chuyển xuất hiện lại sau khi lệnh hoàn tất. Dữ liệu command lỗi khóa thao tác thay vì xóa âm thầm. REQUEST_IN_PROGRESS, HTTP 408/429, lỗi mạng hoặc response chưa hợp lệ giữ nguyên command; retry là thao tác thủ công cùng key/body/version. Command manager kiểm tra owner trực tiếp, completion chỉ invalidates resource phiên; callback màn hình cũ không tải hoặc điều hướng tài khoản mới.

Popup và Offers dùng chung coordinator theo phiên. Command được lưu trước khi gửi, cố định origin/path/method/key/body và version quan sát. Receipt accept chỉ chuyển sang “Đang xác nhận chuyến”; chỉ Trip có cùng tripId/driverId và trạng thái ASSIGNED/DRIVER_ARRIVED/IN_PROGRESS mới xác nhận phân công. GET active Trip null hoặc lỗi mạng không kết luận assignment thất bại. Coordinator đọc offer theo ID đang giữ cho tới khi Matching xác nhận đóng; không nhận lời mời khác chỉ vì HTTP accept đã xong.

Native lưu journal và dấu đóng theo môi trường + driverId + offerId, không chứa token/credential; web chỉ giữ trong bộ nhớ. Khôi phục ưu tiên GET, không tự replay quyết định. Retry thủ công của lệnh chưa rõ kết quả giữ nguyên command; OFFER_CLOSED/IDEMPOTENCY_CONFLICT phải đối soát, không đổi key/version. Record quyết định cũ chưa có endpoint cố định chỉ được đối soát, không replay. Chờ worker Matching/Trip xử lý trạng thái cuối; API public chưa cung cấp lý do chi tiết REJECTED/REVOKED hoặc truy vấn receipt theo key. Chưa kiểm chứng workflow trên thiết bị/backend thật chỉ từ source.

Session restore và refresh dùng single-flight theo owner/epoch; native refresh ở SecureStore, access trong bộ nhớ. Web chỉ giữ trong bộ nhớ runtime. State phân biệt đang phục hồi/refresh, còn sử dụng được, tạm không khả dụng, kết quả refresh chưa rõ, lỗi lưu trữ và bị từ chối/cần đăng nhập lại. Mất mạng/timeout/dependency không xóa credential. Access token chỉ dùng tới hạn đã biết; hết hạn hoặc Driver từ chối thì shell tạm dừng resource xác thực, giữ journal offer/Trip để đối soát sau phục hồi.

SessionManager tăng resource epoch khi phiên chuyển từ không dùng được sang dùng được; shell dựng lại resource theo epoch này kể cả khi React gộp nhiều snapshot vào một render. Owner epoch của command giữ nguyên qua phục hồi cùng tài xế. Refresh bình thường khi access vẫn hợp lệ không dựng lại shell; không đổi chính sách rotation/retry.

Trước refresh, app ghi dấu `uncertain` cùng credential vào SecureStore; chỉ gửi HTTP sau khi lưu dấu thành công. Sau response thành công phải lưu refresh token mới trước khi mở lại shell/giải phóng request chờ. Nếu lưu thất bại, token mới giữ trong bộ nhớ để người dùng thử lưu lại, không quay lại token cũ. Nếu app đóng giữa chừng, dấu chưa rõ kết quả chặn tự refresh token cũ khi mở lại; có thể cần OTP ngay cả khi request chưa tới server. Đăng nhập OTP thay thế cũng đánh dấu credential cũ trước verify để không tự phục hồi tài khoản cũ khi phiên mới chưa lưu được. Đây là metadata local; không lưu access token hay credential trong journal command.

Refresh chưa có replay an toàn (xem [Auth contract](api.md#2-auth)): không tự retry sau timeout/abort/mất response, kể cả khi mạng trở lại. Phục hồi thủ công chỉ đọc lại storage, thử ghi token mới đã nhận/xóa local, hoặc refresh khi biết chưa gửi request trước đó. `401 INVALID_REFRESH_TOKEN` mới chuyển sang cần đăng nhập lại và xóa local. Driver `401 UNAUTHENTICATED` có thể làm mới một lần; request chỉ replay nguyên spec nếu là GET hoặc có idempotency key. 401/403 của service khác, Driver 403 hoặc token mới tiếp tục bị từ chối không tạo vòng refresh/xóa phiên. Sửa cấu hình trust rồi thử lại hoặc chọn OTP theo tình huống.

Logout chủ động dừng owner ngay, xóa local trước khi chờ best-effort revoke ở backend; backend lỗi mạng không mở lại phiên. Nếu native deletion lỗi, app thử ghi tombstone không chứa token; nếu cả hai thao tác storage lỗi, UI báo chưa xóa được và cho thử lại. Không thể bảo đảm xóa bền vững khi hệ điều hành từ chối mọi thao tác storage. Response refresh/login cũ không ghi vào owner mới; nếu nhận được token mới của owner cũ thì best-effort revoke riêng, không điều hướng hoặc mở popup.

OTP form và deadline ở runtime Driver để remount không reset cooldown; giữ dữ liệu nhập khi lỗi mạng. Cooldown thành công theo `retryAfterSeconds`, giới hạn request theo `Retry-After`, không tự gửi lại OTP. Các lỗi challenge/account dùng thông báo chung đúng contract; app không tự kết luận tài khoản thử nghiệm.

Logout/đổi tài khoản/rời shell dọn socket, timer, listener và state phiên; command đang chờ giữ theo owner/môi trường, không tự thực thi sau phục hồi hoặc chuyển sang tài khoản khác. Background tạm dừng polling/socket/GPS; đổi màn hình trong shell giữ publisher, tắt GPS dừng gửi. Reconnect lấy JWT hiện tại và đọc lại REST; không replay GPS cũ. UI PENDING yêu cầu đọc lại, không báo AVAILABLE. App hiện chỉ cấu hình foreground location, chưa bật background task/native service.

UI Driver: shell sở hữu safe area top/side và tab bar sở hữu bottom inset; Screen không cộng chiều cao tab cố định. GPS vẫn có một lifecycle ở shell, thanh trạng thái ngắn ở mọi route và chi tiết trong vùng cuộn Home. Profile/Vehicle giữ trường đang sửa khi refresh nền; notice lưu thành công nằm ở màn hình, chỉ hiển thị sau response xác nhận. Validation cục bộ theo giới hạn Driver; backend hiện trả `details: []`, nên INVALID_REQUEST không được tự gán vào một trường giả định.

Yêu cầu POST xe chưa có idempotency. App giữ body/trạng thái đang gửi hoặc chưa rõ kết quả trong DriverClient theo runtime/owner, không tự POST lại khi đổi route hoặc timeout. Người dùng đọc lại danh sách, đối chiếu biển số (backend chuẩn hóa uppercase, unique) và thông tin trước khi cho phép gửi thủ công. Record này chỉ ở RAM của runtime, không phải journal bền qua đóng app; sau restart phải kiểm danh sách/biển số trước khi đăng ký lại. Schema thực tế vẫn cần đáp ứng unique theo contract; frontend không tạo constraint.

Projection Trip của Driver đọc thêm `timestamps` và `cancellation` từ response hiện có, không thay Trip API/cursor/thứ tự requestedAt DESC. Ngày giờ hiển thị `Asia/Ho_Chi_Minh` và ghi giờ VN; field thiếu được báo chưa có dữ liệu, không suy requestedAt thành thời điểm bắt đầu/kết thúc. Driver bật tùy chọn map `fitKey` theo trip/phase: fit tuyến mới hoặc điểm đón/đến khi chưa có tuyến, một điểm zoom 15; không bám từng mẫu GPS. Nút recenter fit lại theo tuyến/điểm, hoặc GPS hiện tại khi chưa có chuyến. Customer không bật tùy chọn này và giữ camera policy hiện có. Layout, bàn phím/font lớn, VoiceOver/TalkBack và camera native vẫn cần nghiệm thu trên development build/thiết bị.

## 6. Luồng kiểm tra API

Dùng account test được cấp và collection private; không export token/secret.

1. POST /driver-auth/otp/request body {phoneNumber}; lưu data.challengeId.
2. POST /driver-auth/otp/verify body {phoneNumber,challengeId,otp}; dùng mã local/provider riêng; lưu access/refresh private.
3. Bearer access: GET/PATCH /drivers/me; GET/POST /drivers/me/vehicles; kiểm detail/owner/inactive.
4. OFFLINE/no active Trip: PUT /drivers/me/selected-vehicle {vehicleId}; PUT /drivers/me/availability {desiredStatus:"ONLINE"}.
5. GET availability để quan sát APPLIED/PENDING/UNKNOWN. Không tự ghi Redis hoặc sửa data chung để tạo AVAILABLE.
6. Trong môi trường Trip riêng có assignment thật: active/detail/status/cancel/history theo Trip contract, version + Idempotency-Key.
7. Retry cùng body/key; conflict đọc lại rồi tạo command mới; replay response cũ không giảm version.
8. POST refresh/logout; kiểm OTP reuse/expiry, invalid JWT, ownership, ONLINE thiếu xe, OFFLINE giữa chuyến và Redis lỗi sau commit.

HTTP/provider/network failure có thể là kết quả không xác định; không replay POST xe tự động khi chưa đọc lại danh sách. Không dùng thao tác trên dữ liệu chung để kiểm failure.

## 7. Kiểm tra source và test

Chạy từng lệnh riêng trong Driver, xem exit code:

| Lệnh | Phạm vi |
| --- | --- |
| npm.cmd run lint | ESLint src, không autofix |
| npm.cmd run typecheck | TypeScript noEmit, không incremental |
| npm.cmd run check:architecture | Chiều dependency và đường dẫn |
| npm.cmd run check:schema | Cờ ORM và mapping tĩnh, không kiểm schema database thật |
| npm.cmd run test:unit | Policy/use case/UoW double/target guard |
| npm.cmd run test:contract | HTTP DTO/guard/envelope với port bộ nhớ |
| npm.cmd run test:e2e | Driver HTTP trực tiếp với port bộ nhớ, không Gateway/Socket/Trip thật |
| npm.cmd run test:integration | PostgreSQL/Redis riêng; xem mục sau |
| npm.cmd run test | Unit + contract + HTTP e2e, không integration |
| npm.cmd run build | Compile dist; không chứng minh runtime |

App: npm.cmd run lint và npx.cmd tsc --noEmit. Realtime: lint/typecheck/build sau khi có dependency riêng. Không coi build cuối hoặc suite skip là bằng chứng các lệnh khác đã pass. Chưa có suite Realtime và device E2E trong repository.

App hiện có ESLint/TypeScript trong package và cấu hình ESLint riêng. Có thể chạy trực tiếp checker đã cài mà không bootstrap dependency; kiểm tra tĩnh không thay cho kiểm chứng Android/iOS và backend thật.

App `npm.cmd test` chạy cả các test `driver-*.test.cjs`: session/rotation, offer coordinator/journal, resource leases, socket, GPS/navigation lifecycle, form và shell React. Native location/map/navigation và SecureStore được thay ở boundary trong test cô lập; không coi đây là nghiệm thu thiết bị. `react-test-renderer` được pin cùng React 19.2.3, chỉ là dev dependency; renderer có cảnh báo deprecation, không thay thế device E2E.

## 8. Integration target có bảo vệ

Harness không dựng schema hoặc chạy DDL. Cần DDL có thẩm quyền được owner nạp vào database riêng trước. Nó thêm/xóa chỉ row/key UUID do chính test tạo; đây vẫn là thao tác ghi, không chạy trên database dùng chung.

- DRIVER_TEST_STORAGE_ACK=ISOLATED_DRIVER_TEST_ONLY là xác nhận vận hành, không suy ra từ URL.
- DRIVER_TEST_DATABASE_URL: loopback, tên kết thúc _driver_test, không query/hash.
- DRIVER_TEST_REDIS_URL: loopback port 16379, database /15, không query/hash.
- Các URL private không được log/commit; thiếu URL là skip, không phải integration pass.
- Không FLUSHDB, không seed/reset account chung, không test với DATABASE_URL production.

Sau khi xác nhận đích disposable riêng và quyền owner:

```powershell
$env:DRIVER_TEST_STORAGE_ACK = 'ISOLATED_DRIVER_TEST_ONLY'
$env:DRIVER_TEST_DATABASE_URL = 'postgresql://TEST_USER:REPLACE_PASSWORD@127.0.0.1:15432/chande_driver_test'
$env:DRIVER_TEST_REDIS_URL = 'redis://127.0.0.1:16379/15'
```

```powershell
npm.cmd run test:integration
```

Fixture SQL chỉ cho tài khoản/xe của test; không tạo constraint phỏng đoán để nghiệm thu unique. Cần kiểm refresh concurrent/rollback, unique plate/license, advisory lock hai session và Lua thật. Hướng dẫn chưa phải kết quả đã chạy.

### Stack xác minh tích hợp riêng

`scripts/verification-stack.cjs` tạo Compose project `chande-driver-verification` tại `service/driver-service/node_modules/.cache/driver-verification-stack`, với keys/env private, volume/database/Redis/RabbitMQ riêng và ingress loopback 18082. Nó đọc topology `deploy/stack.cjs`, SQL fixture local và graph OSRM đã chuẩn bị; không dùng `deploy/.local/backend` hoặc dữ liệu demo đang chạy. Fixture này chỉ là schema kiểm thử local, không phải migration production. Script từ chối ghi đè directory có sẵn. Trước lần tạo mới, xác nhận project/port này chưa được sử dụng và các image service thật đã build từ revision muốn kiểm tra.

Từ root, sau khi có Docker Linux và OSRM graph/image:

```powershell
$env:DRIVER_TEST_STORAGE_ACK = 'ISOLATED_DRIVER_TEST_ONLY'
node service/driver-service/scripts/verification-stack.cjs
docker build -t chande-driver-verification:local service/driver-service
docker compose -f service/driver-service/node_modules/.cache/driver-verification-stack/compose.json up -d --wait --wait-timeout 240
```

Driver image được build riêng từ source hiện tại. Các service khác dùng image thật theo `deploy/stack.cjs`; harness không sửa source hoặc thay deployment hiện có. Trip/Matching migration và User Flyway chỉ chạy trên PostgreSQL mới của project test.

Realtime trong harness có `SOCKET_CORS_ORIGINS` cho web local 5500/8081 và native Android qua `localhost`, `127.0.0.1`, `10.0.2.2` tại đúng ingress port (mặc định 18082). Android React Native tự thêm header `Origin` từ endpoint WebSocket; origin này khác Metro 8081. Thiếu allowlist khiến Engine.IO WebSocket upgrade trả HTTP 400 với body `Forbidden` trước khi kiểm JWT: map vẫn nhận GPS thiết bị nhưng GPS server và offer không kết nối được. Không dùng wildcard hoặc giả header Origin để che cấu hình sai; issuer/audience/JWKS vẫn phải khớp.

Stack đã được tạo trước khi có cấu hình này: bổ sung các origin chính xác vào `realtime-api.env` trong private directory của harness, giữ mọi giá trị credential hiện có. Chỉ tạo lại container Realtime để nạp env; không chạy lại generator hoặc xóa volume:

```powershell
docker compose -f service/driver-service/node_modules/.cache/driver-verification-stack/compose.json up -d --no-deps --force-recreate --wait realtime-api
```

Probe chỉ kiểm transport/origin và JWT bắt buộc, không seed tài khoản, gửi GPS hoặc sửa chuyến:

```powershell
$env:APP_BACKEND_URL = 'http://127.0.0.1:18082'
$env:DRIVER_REALTIME_ORIGIN_PROBE = '1'
node --test service/driver-service/test/contract/realtime-origin.test.cjs
Remove-Item Env:DRIVER_REALTIME_ORIGIN_PROBE
```

Probe dùng client đã cài theo lockfile của `app/`. Nó xác nhận Android origin qua Engine.IO nhận 101, origin lạ nhận HTTP 400 `Forbidden`, namespace `/realtime` vẫn từ chối khi thiếu Driver JWT. Đây chưa phải nghiệm thu GPS/offer trên emulator hoặc thiết bị.

Từ `app/`, chạy test live chỉ tới ingress riêng này (các test có ghi dữ liệu):

```powershell
$env:APP_BACKEND_URL = 'http://127.0.0.1:18082'
$env:APP_INTEGRATION = '1'
$env:DRIVER_APP_INTEGRATION = '1'
$env:DRIVER_TEST_STORAGE_ACK = 'ISOLATED_DRIVER_TEST_ONLY'
node --test --test-concurrency=1 --test-timeout=150000 test/*.test.cjs
```

`driver-live.test.cjs` kiểm tra chính các adapter/session/coordinator/command manager Driver, GPS Socket.IO với tọa độ fixture, assignment đúng trip/driver/vehicle và hoàn thành/lịch sử. GPS sensor và native rendering vẫn chưa được kiểm tra bằng test live HTTP/socket. Suite live cũ có account/biển số fixture cố định; không bật cờ live tới database của nhóm. Khi kết thúc môi trường disposable do chính mình tạo, từ root:

```powershell
docker compose -f service/driver-service/node_modules/.cache/driver-verification-stack/compose.json down --volumes
```

Lệnh này xóa dữ liệu của project test. Không thay bằng compose production, không dùng `docker system prune` hoặc xóa namespace/PVC chung. Giữ private generated directory nếu muốn khởi động lại cùng stack; muốn tạo stack mới hoàn toàn cần dừng/xóa đúng volume test trước rồi xóa đúng directory test. Không commit generated env/key/log/artifact.

## 9. Chẩn đoán và bàn giao

| Hiện tượng | Kiểm tra |
| --- | --- |
| Startup failed / ready 503 | DSN/quyền/schema/type/nullable/legacy CHECK/status; không chạy synchronize hoặc migration |
| TRIP_MODE must be real | Private config cũ còn mock; chuyển mode real và URL tới Trip thật |
| DRIVER_STATUS_MIGRATION_REQUIRED | Owner chốt xử lý dữ liệu legacy/cơ chế khóa, không ACTIVE→ONLINE |
| Chọn/sửa xe 503 | Trip URL/trust JWT/dependency; không giả active=null |
| ONLINE VEHICLE_REQUIRED/INACTIVE | Owner, xe active/selection; mất cache phải chọn lại đúng quy tắc |
| PENDING/UNKNOWN | Intent PG đã lưu hoặc operational chưa biết; reconcile, nguồn Trip/projection |
| 401 Trip/Realtime | Issuer/audience/JWKS/kid/expiry/clock; lấy JWT mới sau đổi key/audience |
| Web network error | URL/CORS/TLS/ingress; cấu hình Driver hiện chưa CORS browser |
| Typecheck thiếu module | Dependency/lockfile cài chưa khớp; không đổi interface thành any |

Gateway chuẩn cần xác nhận proxy headers/path, internal route exposure, trusted forward-IP, Socket.IO namespace/origin và nguồn state/resync. Routing xác nhận nearby/error semantics; Matching xác nhận offer/reservation/assignment với Trip. Không có transaction chung PG/Redis/Trip, durable Trip event receiver hoặc thông báo room chuyến trong Driver/Realtime v1.
