# Deploy và vận hành Realtime Service

| Thuộc tính | Giá trị |
| --- | --- |
| Service | realtime-service |
| Rà soát | 2026-10-06 |
| Quy ước | [Format và số liệu](../../../docs/quy-uoc-tai-lieu.md) |

Hướng dẫn chạy trên môi trường riêng. Các bước runtime bên dưới là quy trình vận hành và tiêu chí kiểm chứng, không phải kết quả kiểm thử đã chạy. [Kiến trúc](kien-truc.md), [API](api.md), [Routes](routes.md), [Nghiệp vụ](nghiep-vu.md).

Kết quả GPS/nearby/offer/reconnect thật: [báo cáo Matching](../../matching-service/docs/bao-cao-trien-khai.md). Offer cần RABBITMQ_URL, MATCHING_BASE_URL, MATCHING_REALTIME_TOKEN; startup/shutdown/retry/DLQ theo [runbook Matching](../../matching-service/docs/deploy.md). Không ghi đè .env hoặc volume existing.

## 1. Topology và điều kiện local

| Thành phần | Địa chỉ ví dụ | Vai trò |
| --- | --- | --- |
| Realtime | http://localhost:3004 | HTTP và Socket.IO /realtime cùng process |
| Redis riêng Realtime | 127.0.0.1:56379 | GPS/expiry/watermark; không dùng key Driver |
| Driver/JWKS | http://127.0.0.1:3003 | OTP/JWT, JWKS, batch eligibility |
| App Expo | Web origin thường localhost:8081 | Foreground GPS; thiết bị/emulator dùng URL thích hợp |
| Trip | Theo config Driver | Driver có thể cần Trip khi chọn/sửa xe; Realtime không gọi Trip |

Node >=24 <25 theo package. Runbook local dùng Redis 7.4; chưa test ma trận phiên bản. Realtime không cần PostgreSQL, migration, Gateway demo hoặc Trip mock. Driver cần schema/tài khoản test hợp lệ được cấp; không tạo schema phỏng đoán hoặc reseed DB chung.

Realtime có Dockerfile/lockfile; [Matching compose](../../matching-service/compose.local.yml) chạy Redis 8, host Realtime 3009. Redis 7.4 trong runbook dưới là ví dụ riêng, không phải phiên bản smoke Matching. Chưa có production ingress. Realtime/Routing cùng default 3004, Driver/Trip mock cùng default 3003; phải override khi chạy chung.

## 2. Scripts hiện có

| Script | Lệnh / chức năng |
| --- | --- |
| start:dev | ts-node src/main.ts; không watch tự reload |
| build | tsc -p tsconfig.json → dist/ |
| start | node dist/main.js, cần build trước |
| typecheck | tsc --noEmit -p tsconfig.json |
| lint | eslint src scripts, không autofix |
| gps:send | node scripts/send-location.mjs |

Chưa có test suite/script test, migration, Swagger generation hoặc worker riêng ở Realtime. Build pass không thay thế kiểm thử Redis/thiết bị.

## 3. Biến môi trường thật

Đối chiếu [.env.example](../.env.example) với [loadConfig](../src/bootstrap/config/configuration.ts). Sample không đồng nghĩa loader cung cấp default cho biến bắt buộc.

| Biến | Default trong code hoặc sample | Validation / ý nghĩa |
| --- | --- | --- |
| NODE_ENV | Sample development | Loader Realtime không đọc để chọn adapter/production gate; không mock adapter |
| PORT | Default 3004 | Integer 1–65.535 |
| REDIS_URL | Bắt buộc; sample redis://127.0.0.1:56379/0 | redis/rediss URL; Redis riêng/ACL phù hợp |
| REDIS_TIMEOUT_MS | Default 3.000 | Integer 1–60.000; connect/command timeout |
| AUTH_JWKS_URL | Bắt buộc; sample http://127.0.0.1:3003/.well-known/jwks.json | HTTP(S), không credentials/query/hash |
| AUTH_JWT_ISSUER | Bắt buộc; sample http://localhost:3003 | Khớp iss chính xác, không suy ra từ hostname JWKS |
| AUTH_JWT_AUDIENCE | Default realtime-service | Phải có trong aud Driver JWT |
| AUTH_JWKS_TIMEOUT_MS | Default 3.000 | Integer 1–10.000 |
| ROUTING_INBOUND_TOKEN | Bắt buộc, sample placeholder | Routing → Realtime; >=32 ký tự, không bắt đầu REPLACE_ |
| DRIVER_ELIGIBILITY_TOKEN | Bắt buộc, sample placeholder | Realtime → Driver; >=32 ký tự, khác Routing token, bằng REALTIME_INBOUND_TOKEN của Driver |
| DRIVER_BASE_URL | Bắt buộc; sample http://127.0.0.1:3003 | HTTP(S), không credentials/query/hash |
| DRIVER_TIMEOUT_MS | Default 3.000 | Integer 1–10.000; deadline chung cho tất cả batch |
| LOCATION_FRESHNESS_MS | Default/tối đa 30.000 | Integer 1–30.000; tuổi phải nhỏ hơn ngưỡng |
| LOCATION_MAX_FUTURE_MS | Default 5.000 | Integer 1–10.000 |
| LOCATION_MAX_ACCURACY_METERS | Default 100 | Integer 1–1.000; accuracy input 0 đến ngưỡng |
| LOCATION_MIN_UPDATE_INTERVAL_MS | Default 1.000 | Integer 1–10.000; khác chu kỳ app |
| LOCATION_ORDER_RETENTION_MS | Default 86.400.000 | Integer <=604.800.000, phải >freshness; watermark dọn theo scheduler |
| CLEANUP_INTERVAL_MS | Default 10.000 | Integer 1–60.000 |
| CLEANUP_BATCH_SIZE | Default 500 | Integer 1–5.000; giới hạn GPS và watermark mỗi tick |
| NEARBY_MAX_CANDIDATES | Default 5.000 | Integer 1–50.000; trần GEO rows trước stale filter, vượt trả 503 |
| SOCKET_CORS_ORIGINS | Default/sample http://localhost:8081,http://127.0.0.1:8081 | Origin exact, dấu phẩy; client không Origin vẫn phải auth |

Loader hỗ trợ NAME_FILE cho biến đọc qua value(), gồm URL/issuer/tokens/config; không đặt đồng thời giá trị và _FILE. Hai credential khác nhau, không đưa vào EXPO_PUBLIC_*, source, collection chia sẻ hoặc log. Redis DSN có password là secret. Radius tối đa 2.000 m, result limit 50 hardcode trong NearbyPolicy; chu kỳ app 10 giây không phải biến Realtime.

Mỗi đoạn Set-Location bên dưới giả định terminal mới tại root repository; không chạy nối tiếp các đường dẫn tương đối từ terminal đang ở service khác.

## 4. Chuẩn bị Redis và Driver

Thực hiện trên môi trường riêng được phép dùng. Nếu Redis phù hợp đã có, dùng URL đó; không xóa/reset instance. Nếu chưa có và Docker Desktop engine đang hoạt động, tạo container local riêng:

```powershell
docker run --name chande-realtime-redis -p 127.0.0.1:56379:6379 -d redis:7.4-alpine
```

Container cùng tên đã tồn tại thì xem trạng thái/dùng lại phù hợp; không tạo bản trùng hoặc dọn volume. Không Docker thì chuẩn bị Redis riêng qua môi trường được cấp. Không thay Redis bằng mock để tuyên bố Lua đã chạy.

Trong cấu hình private Driver, dùng các audience của consumer hiện tại và credential riêng:

```dotenv
AUTH_JWT_AUDIENCES=driver-service,trip-service,realtime-service
REALTIME_INBOUND_TOKEN=REPLACE_WITH_PRIVATE_REALTIME_TO_DRIVER_CREDENTIAL
```

Thay placeholder bằng credential >=32 ký tự, khác MATCHING_INBOUND_TOKEN. Realtime dùng cùng giá trị ở DRIVER_ELIGIBILITY_TOKEN. Chưa đặt thì Driver có thể chạy nhưng batch từ chối 401. Driver vẫn cần config database/OTP/Trip/Redis của chính nó; xem [hướng dẫn Driver](../../driver-service/docs/deploy.md). Không đổi legacy status hoặc chạy migration Trip trên Driver DB.

Sau khi Driver config/dependency/schema đã đúng, chạy ở terminal riêng:

```powershell
Set-Location service/driver-service
npm.cmd run start:dev
```

Restart có chủ đích khi đổi cấu hình. Driver local không keyFile sinh key/kid mới sau restart, cần JWT mới. Không chia sẻ private signing key cho Realtime/app.

## 5. Cài và chạy Realtime — PowerShell

```powershell
Set-Location service/realtime-service
node --version
```

Lockfile đã có và được kiểm chứng; dùng install có chủ đích chỉ khi thay dependency, còn checkout dùng ci:

```powershell
npm.cmd ci
```

Chỉ copy sample nếu chưa có private .env:

```powershell
if (-not (Test-Path -LiteralPath '.env')) {
  Copy-Item -LiteralPath '.env.example' -Destination '.env'
}
```

Điền Redis/JWKS/Driver URL, issuer/audience và hai credential thật trong file riêng. Không để REPLACE_ hoặc token giống nhau. Biến $env:... ở terminal có thể override dotenv; kiểm config cũ mà không in secret. JWKS dùng 127.0.0.1 có thể đi cùng issuer localhost; issuer phải giống claim chính xác.

```powershell
npm.cmd run start:dev
```

Không watch; sửa source/config cần restart có chủ đích. Kiểm tra tùy chọn sau install, chạy riêng từng lệnh và xem exit code:

```powershell
npm.cmd run lint
```

```powershell
npm.cmd run typecheck
```

```powershell
npm.cmd run build
```

Build tạo dist, npm.cmd run start dùng bản compile; start:dev dùng source. Kiểm tra riêng exit code mỗi lệnh.

## 6. Health và JWKS — Postman

| Request | Mong đợi |
| --- | --- |
| GET http://localhost:3004/health/live | 200 {status:ok} |
| GET http://localhost:3004/health/ready | 200 {status:ready,redis:ready} hoặc 503 not_ready |
| GET http://localhost:3003/.well-known/jwks.json | {keys:[public JWK]} từ Driver đúng |

Ready chỉ PING Redis, không chứng minh batch Driver/JWKS/Trip/projection AVAILABLE hoặc quyền EVAL/GEO. Service có thể listen sau Redis connect lỗi; live 200 chưa đủ. Không có Swagger Realtime.

## 7. Driver JWT và xe — Postman

Tạo các biến private driverBaseUrl, driverPhone, localOtp/providerOtp, driverAccessToken, driverRefreshToken. Không export giá trị thật hoặc in console.

1. POST {{driverBaseUrl}}/driver-auth/otp/request, Content-Type application/json:

```json
{ "phoneNumber": "{{driverPhone}}" }
```

2. Lưu data.challengeId; POST /driver-auth/otp/verify:

```json
{
  "phoneNumber": "{{driverPhone}}",
  "challengeId": "{{driverChallengeId}}",
  "otp": "{{localOtp}}"
}
```

Mock local dùng code riêng OTP_MOCK_CODE khi Driver cấu hình mock; API không trả/log code. Provider dùng mã được cấp. Dùng tài khoản đã tồn tại, số điện thoại hợp lệ; OTP không đăng ký Driver. Lưu data.accessToken/refreshToken riêng; không dùng Trip mock JWT hoặc tắt verifier.

3. Với Authorization Bearer {{driverAccessToken}}, GET /drivers/me, GET/POST /drivers/me/vehicles. Hồ sơ đủ, xe đúng owner/active/type. Chuẩn bị qua tài khoản test được cấp, không seed/reset DB chung.
4. Khi OFFLINE và Driver đã xác minh không có active Trip, PUT /drivers/me/selected-vehicle:

```json
{ "vehicleId": "{{ownActiveVehicleId}}" }
```

5. PUT /drivers/me/availability:

```json
{ "desiredStatus": "ONLINE" }
```

PENDING là ý định đã lưu, sync chờ. ONLINE không phải AVAILABLE. Nếu Trip chưa sẵn sàng cho bước chọn xe, xử lý dependency Driver; không giả active=null. Sau đổi audience/key/issuer lấy JWT phù hợp. Refresh POST /driver-auth/refresh thuộc Driver; CLI không tự refresh. Logout phải đóng GPS client; access token không có revoke tức thì tại Realtime.

## 8. GPS và ACK — Socket.IO client

CLI scripts/send-location.mjs có sẵn; chạy từ Realtime sau install. Raw WebSocket của Postman không thay Socket.IO protocol. Với công cụ có hỗ trợ Socket.IO v4, đặt namespace/auth/event theo [API](api.md); CLI là cách kiểm thử chuẩn ở đây.

```powershell
$rtDriverJwt = Read-Host 'Driver access token' -AsSecureString
$env:DRIVER_ACCESS_TOKEN = [System.Net.NetworkCredential]::new('', $rtDriverJwt).Password
$env:REALTIME_BASE_URL = 'http://127.0.0.1:3004'
$env:GPS_LATITUDE = '0.0003'
$env:GPS_LONGITUDE = '0.0004'
$env:GPS_ACCURACY = '12'
$env:GPS_COUNT = '1'
```

Tọa độ quanh 0,0 là dữ liệu tổng hợp, không tọa độ người dùng. CLI mặc định tạo timestamp UTC mới mỗi lần:

```powershell
npm.cmd run gps:send
```

ACK success có data.accepted=true, disposition STORED/DUPLICATE, recordedAt/receivedAt, meta.requestId. ACK error không có data success. Script chỉ in ACK/code, không JWT/GPS payload; timeout/connect lỗi exit 1. Timeout không chứng minh Redis chưa ghi.

GPS_COUNT=0 rồi chạy lại để loop 10 giây đến Ctrl+C. CLI không tự reconnect/refresh, cần JWT mới khi hết hạn. Test ordering: ghi lại recordedAt từ ACK, đặt GPS_RECORDED_AT bằng time đó hoặc cũ hơn nhưng còn freshness; cùng time/tọa độ/accuracy trả duplicate, cùng time khác tọa độ hoặc time cũ hơn trả out-of-order. Time đạt 30 giây tuổi trả stale trước duplicate.

Khi xong hoặc muốn timestamp tự động:

```powershell
Remove-Item Env:GPS_RECORDED_AT -ErrorAction SilentlyContinue
Remove-Item Env:DRIVER_ACCESS_TOKEN -ErrorAction SilentlyContinue
```

Chỉ bỏ biến terminal, không xóa Redis/DB. Chưa có bằng chứng nghiệm thu ACK với Redis thật.

## 9. Nearby và eligibility diagnostic — Postman

```http
GET http://localhost:3004/internal/realtime/nearby-drivers?latitude=0&longitude=0&vehicleType=BIKE
X-Service-Token: {{routingRealtimeToken}}
```

Private routingRealtimeToken bằng ROUTING_INBOUND_TOKEN, không JWT. Bỏ vehicleType để lấy các loại; radiusMeters default/max 2000. Response 200 là mảng data.drivers gần → xa tối đa 50; không assignment. Ví dụ hai xe trong API là shape, không kết quả đã chạy.

Người có credential riêng có thể kiểm batch Driver:

```http
POST http://localhost:3003/internal/drivers/eligibility/batch
X-Service-Token: {{realtimeToDriverToken}}
Content-Type: application/json
```

```json
{
  "driverIds": [
    "40000000-0000-4000-8000-000000000001",
    "40000000-0000-4000-8000-000000000002"
  ],
  "vehicleType": "BIKE"
}
```

Thay UUID mẫu bằng tài khoản test đang gửi GPS. Credential bằng REALTIME_INBOUND_TOKEN/DRIVER_ELIGIBILITY_TOKEN, khác Routing token. Xem eligible/availabilityKnown/operationalStatus/reasons. UNKNOWN cần chủ Driver/Matching/Gateway xác nhận producer/freshness/đối soát Trip; không HSET AVAILABLE hoặc sửa DB để ca test pass.

## 10. Tình huống kiểm thử thủ công

| Tình huống | Thao tác / điều kiện | Mong đợi |
| --- | --- | --- |
| Nhiều xe gần | Hai Driver test có xe/hồ sơ hợp lệ và AVAILABLE được nguồn chính thức xác nhận; hai JWT/terminal GPS_COUNT=0; A 0.0003,0.0004, B 0.001,0.001 | Danh sách nhiều xe đúng type/gần → xa; nếu producer chưa có, ca này bị chặn |
| Không xe phù hợp | Không GPS trong radius hoặc các ứng viên bị loại có căn cứ: OFFLINE/BUSY/inactive/sai loại | 200 drivers:[], không Trip/assignment side effect |
| GPS hết hạn | Gửi GPS_COUNT=1, không gửi tiếp, chờ >30 giây rồi nearby | Mẫu bị loại kể cả cleanup chưa dọn; hết candidate thì [] |
| UNKNOWN | Hồ sơ/xe ONLINE hợp lệ, projection chưa xác minh | 503 ELIGIBILITY_UNDETERMINED, không AVAILABLE giả |
| JWT/credential sai | Sai issuer/audience/role/expiry; nearby thiếu token hoặc chỉ JWT | connect_error hoặc HTTP 401 tương ứng |
| Ordering/duplicate | Cùng timestamp payload giống/khác, mẫu cũ sau mẫu mới | Không ghi đè; duplicate không kéo dài expiry |
| Redis/Driver lỗi | Outage mô phỏng được phép ở môi trường riêng | ready/ACK/nearby lỗi rõ, không [] giả |
| Cleanup race | Nhiều client gửi quanh expiry trên Redis riêng | Mẫu mới hợp lệ không bị cleanup cũ xóa; cần kiểm chứng runtime |

Empty nearby, disconnect hoặc expiry GPS không kết thúc Trip/reservation. Các ca là tiêu chí đối chiếu; kết quả runtime GPS/nearby/offer/reconnect đã có trong báo cáo Matching, không đồng nghĩa mọi ca thiết bị/background đã nghiệm thu.

## 11. App foreground và Expo Go

App có [module GPS](../../../app/src/features/driver/gps/use-driver-gps.ts), GpsCard trong OverviewScreen và dependency/plugin khai báo. Chuẩn bị dependency theo SDK đang dùng:

```powershell
Set-Location app
npx.cmd expo install expo-location socket.io-client
```

EXPO_PUBLIC_DRIVER_REALTIME_BASE_URL theo [sample](../../../app/realtime.env.example): thiết bị thật IP LAN backend:3004; Android emulator thường 10.0.2.2:3004; web cùng PC localhost:3004. URL là origin, không thêm /realtime hoặc /socket.io/. Restart Expo sau đổi env; web origin phải allowlist, firewall/LAN phải kết nối được.

```powershell
npm.cmd run start
```

Driver → OTP → xe → ONLINE → Bật GPS → cấp quyền foreground. Kiểm Tắt GPS/logout/rời màn hình/background/thu hồi quyền/reconnect. Availability poll mục tiêu 10 giây, dừng sau khi quan sát mất điều kiện. OS đo có thể chậm, không cam kết đúng mỗi 10 giây.

Theo [Expo Location SDK57](https://docs.expo.dev/versions/v57.0.0/sdk/location/), expo-location có trong Expo Go; thay native config/plugin cần binary mới. Background location iOS không hỗ trợ trong Expo Go, cần development build. V1 chỉ foreground, không TaskManager/background task; app.json tắt background/Android foreground service. Không tuyên bố đã test nền hoặc US8; chưa có bằng chứng nghiệm thu trên thiết bị.

## 12. Chẩn đoán lỗi

| Hiện tượng | Kiểm tra |
| --- | --- |
| Startup failed | Node24/dependency/config bắt buộc, token placeholder/trùng, value và _FILE đồng thời; logger hiện không in chi tiết |
| UNAUTHENTICATED/connect_error | JWT Driver đúng issuer/key/audience realtime-service/role/exp/iat; đồng bộ clock; không JWT Trip mock |
| Origin bị từ chối | Origin exact, Socket.IO namespace/path/transport đúng |
| live 200, ready 503 | Redis URL/port/auth/ACL/network; không in DSN/password chia sẻ |
| ready 200 nhưng operation lỗi | PING chưa chứng minh EVAL/GEO/TIME/HASH/ZSET permission, Driver/JWKS |
| DEPENDENCY_UNAVAILABLE nearby | Driver URL/deadline/token/schema/Redis, batch đủ ID và đúng envelope/type; token khác Routing |
| ELIGIBILITY_UNDETERMINED | availabilityKnown=false; nguồn projection/resync chưa chốt, không tự đánh dấu AVAILABLE |
| LOCATION_STALE | Timestamp đo mới; GPS_RECORDED_AT cố định không dùng loop dài |
| LOCATION_IN_FUTURE / OUT_OF_ORDER | Clock lệch hoặc watermark mới hơn; reconnect không reset watermark |
| RATE_LIMITED | Mẫu mới dưới min interval, kiểm timer/client trùng |
| drivers:[] | Đúng pickup/radius/type, freshness, batch reasons; [] khác outage |
| 401 INVALID_SERVICE_CREDENTIAL | Header thiếu/sai, Routing và batch dùng token khác nhau, env terminal override |
| SEARCH_CAPACITY_EXCEEDED | GEO rows vượt cap kể cả stale chưa cleanup; không cắt danh sách trước lọc |
| App chưa gửi | Phiên/ONLINE/selection/focus/foreground/quyền/services, URL LAN/emulator/dependency; UI có thể không giữ code handshake |

## 13. Bàn giao vận hành

Production còn cần TLS/ingress, private internal/probes, credential rotation/ACL, persistence và monitoring clock/capacity/outage. Expiry là logic theo member/field; cleanup lỗi có thể giữ dữ liệu vật lý, read vẫn lọc stale. Ready không phải health toàn hệ thống.

Routing xác nhận caller/mapping/credential/error handling; Driver xác nhận producer/freshness operational state với active Trip. Gateway chuẩn cần namespace/path/origin/proxy; consumer GEO cũ cần chuyển tường minh. Không đọc key Driver/trip_db để bù API thiếu, không hứa snapshot loại hết assignment race.

Chưa có bằng chứng integration Redis/Driver/Routing hoặc device E2E. Realtime không có PostgreSQL/ORM; xác minh schema/dữ liệu Driver là công việc riêng của owner Driver. Kiểm tra tĩnh không chứng minh runtime hoặc schema database thực.
