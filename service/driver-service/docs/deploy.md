# Chạy và vận hành Driver

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
| AUTH_JWT_AUDIENCES | driver-service,trip-service,realtime-service; bắt buộc có driver-service |
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

Driver HttpTripActive chuyển Authorization người dùng vào GET TRIP_BASE_URL/trips/active; không credential service, không lookup driverId. Trip cần AUTH_JWKS_URL trỏ /.well-known/jwks.json của Driver, AUTH_JWT_ISSUER khớp Driver và audience trip-service. Sample Trip hiện dùng /jwks và issuer chande-local; owner/vận hành Trip phải cấu hình phù hợp. Không sửa code Trip để bù khác biệt.

Realtime: AUTH_JWKS_URL/issuer tương tự, audience realtime-service; DRIVER_ELIGIBILITY_TOKEN bằng REALTIME_INBOUND_TOKEN, khác ROUTING_INBOUND_TOKEN. [Deploy Realtime](../../realtime-service/docs/deploy.md) có GPS/nearby/CLI và điều kiện riêng.

Nguồn operational AVAILABLE/BUSY, freshness và đối soát active Trip cần Matching/Trip/Gateway chính thức xác nhận. GPS mới/ONLINE không tự AVAILABLE. Khi nguồn đó chưa có, nearby có thể trả ELIGIBILITY_UNDETERMINED; không HSET giả hoặc suy ra hết chuyến từ TTL.

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

Thêm giá trị từ [driver.env.example](../../../app/driver.env.example) và [realtime.env.example](../../../app/realtime.env.example) vào private env app. Mode mặc định direct. Driver URL port 3003, Realtime port 3004; URL thiết bị thật là IP LAN máy backend, Android emulator thường 10.0.2.2, localhost chỉ cho cùng máy.

Trip URL và EXPO_PUBLIC_DRIVER_TRIP_TRUST_CONFIRMED=true chỉ đặt sau khi issuer/JWKS/audience liên thông đã xác nhận; nếu chưa, TripClient disabled, không gửi JWT vào endpoint chưa tin cậy. Gateway mode tùy chọn dành cho ingress chính thức, cần mapping path và contract-confirmed flag; không có default URL Gateway demo.

```powershell
npm.cmd run start
```

Tab Driver: OTP → hồ sơ → phương tiện → chọn xe khi OFFLINE/no active Trip → ONLINE → Bật GPS foreground. Matching offer chưa nối; chuyến thật phải được assignment qua service đúng chủ sở hữu. App polling active/history/detail, không tạo offer/chuyến local để giả tích hợp.

Session restore dùng refresh single-flight; native refresh ở SecureStore, access trong bộ nhớ. Web có giới hạn storage riêng. Logout/rời màn hình/background/Tắt GPS dọn socket/timer. Reconnect dùng JWT mới và đọc lại active Trip; không replay GPS cũ. UI PENDING yêu cầu đọc lại, không báo AVAILABLE.

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

App hiện chưa có cấu hình/dependency ESLint riêng; Expo lint có thể bootstrap chúng. Chuẩn bị và review cấu hình trước khi chạy, tránh coi rà soát bằng TypeScript ESLint dùng tooling lân cận là Expo lint đầy đủ.

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
