# Frontend Chande — app khách và dẫn đường tài xế

Ngày cập nhật: 06/10/2026. Nhánh `FE`. Tài liệu mô tả phần đã làm, cách cấu hình/chạy và việc còn lại.

## 1. Phạm vi

| Phần | Nội dung | Nền tảng |
| --- | --- | --- |
| App khách (RIDER) | Đăng ký/đăng nhập, đặt chuyến (báo giá theo loại xe, xác nhận), theo dõi chuyến, hoá đơn, lịch sử, tài khoản, địa chỉ đã lưu | Android, iOS, web (Expo) |
| Dẫn đường tài xế | Dẫn đường từng chặng tới điểm đón/điểm trả bằng **MapLibre Navigation SDK** | Android (native); iOS/web dùng bản dự phòng: bản đồ + tuyến + danh sách chỉ dẫn |

App khách là màn hình mặc định (`/`); app tài xế hiện có (`src/features/driver`, `/driver`) giữ nguyên, chỉ thêm màn dẫn đường và nút mở từ màn "Chuyến hiện tại". Màn mẫu của Expo (Home/Explore) đã bỏ.

## 2. Nguồn thiết kế

- Thiết kế Stitch xuất ra **một màn hình** (chọn loại xe và xác nhận đặt chuyến) cùng `DESIGN.md` mô tả design system "Velox": teal `#00685F`/`#0D9488`, font Inter, bottom sheet bo 32px, badge trạng thái (tìm tài xế/đang đến/hoàn thành/đã huỷ), thanh tab Ride/Activity/Account.
- Các màn khác được dựng theo `DESIGN.md`. Token nằm ở `src/design/tokens.ts`.
- Khác với bản Stitch:
  - Tên thương hiệu đổi từ Velox sang Chande; giá tính bằng VND; tên tầng xe theo mã xe của hệ thống (`BIKE`, `CAR_4`, `CAR_7`).
  - Bỏ ô mã khuyến mãi và thẻ Visa: backend chưa có dịch vụ khuyến mãi/thanh toán. Hiển thị "Tiền mặt".
  - Ảnh xe 3D trong bản Stitch là ảnh tạm của Stitch, thay bằng icon.
  - Dòng "Fare fixed for next 4:58" dùng `expiresAt` của báo giá (Trip giữ giá 5 phút).

## 3. Cấu trúc thư mục

| Đường dẫn | Nội dung |
| --- | --- |
| `src/design/` | Design system Velox: token, chữ (`Txt`), icon (Material Symbols ↔ SF Symbols), nút, thẻ, badge trạng thái, ô nhập, header, khối điểm đón/đến |
| `src/features/map/` | Bản đồ dùng chung `RideMap`: MapLibre React Native 11.5 (`ride-map.tsx`), maplibre-gl 5.24 cho web (`ride-map.web.tsx`), marker, ghim chọn vị trí |
| `src/features/navigation/` | Lõi dẫn đường TypeScript: polyline, hình học, câu chỉ dẫn tiếng Việt, dựng `DirectionsRoute`, nguồn tuyến (routing-service/OSRM), theo dõi tiến trình, phiên dẫn đường native |
| `src/features/rider/` | App khách: cấu hình, HTTP (hai định dạng lỗi), phiên đăng nhập, client User/Trip, geocoder Photon, WebSocket `/ws`, store đặt chuyến/theo dõi chuyến/tài khoản, màn hình |
| `src/features/driver/screens/navigation-screen.tsx` | Màn dẫn đường tài xế |
| `src/app/(rider)/` | Route app khách: `login`, `register`, `(app)` (cổng đăng nhập) gồm tab `/`, `/activity`, `/account` và `/place`, `/trip/[id]`, `/profile`, `/password`, `/addresses`, `/addresses/edit` |
| `modules/chande-navigation/` | Module Expo cục bộ (Android) bọc MapLibre Navigation SDK, kèm config plugin |

### Màn hình app khách

| Màn | Nội dung |
| --- | --- |
| Đặt xe (`/`) | Đúng bố cục Stitch: header, bản đồ có tuyến và nhãn "km • phút", sheet bo góc với điểm đón (GPS) / điểm đến, danh sách loại xe (báo giá R01 từng loại), thanh toán tiền mặt, nút "Đặt Chande Car · giá" và dòng "giá được giữ 4:58". Khi có chuyến: badge trạng thái, tài xế + biển số, huỷ chuyến có lý do. Kết thúc: hoá đơn hoặc lý do huỷ |
| Chọn điểm (`/place`) | Tìm kiếm Photon (tuỳ chọn), vị trí hiện tại, địa chỉ đã lưu, kéo bản đồ đặt ghim |
| Hoạt động (`/activity`) | Lịch sử chuyến (cursor), lọc Tất cả/Hoàn thành/Đã huỷ, chi tiết chuyến với dòng thời gian trạng thái |
| Tài khoản (`/account`) | Hồ sơ, sửa thông tin, đổi mật khẩu (đăng xuất mọi phiên), địa chỉ đã lưu (tối đa 10), đăng xuất / đăng xuất mọi thiết bị, mở app tài xế |
| Đăng nhập, đăng ký | SĐT + mật khẩu; lỗi từng ô lấy từ `fieldErrors` của User Service; đăng ký xong tự đăng nhập |

## 4. API backend app khách dùng

Mọi request đi qua API Gateway (`/api/v1`), xem [tài liệu gateway](../../service/api-gateway/docs/api-gateway.md).

| Màn hình | API |
| --- | --- |
| Đăng ký, đăng nhập, phiên | User A1 `POST /auth/register`, A2 `/auth/login`, A3 `/auth/refresh`, A4 `/auth/logout`, A5 `/auth/logout-all` |
| Tài khoản | P1/P2 `GET/PATCH /users/me`, P3 `POST /users/me/password` (đổi mật khẩu thu hồi mọi phiên) |
| Địa chỉ đã lưu | D1–D5 `/users/me/addresses` |
| Đặt chuyến | Trip R01 `POST /trips/estimate` cho từng loại xe, R02 `POST /trips` với `Idempotency-Key` |
| Theo dõi chuyến | Trip `GET /trips/active`, `GET /trips/{id}`, R07 `POST /trips/{id}/cancel`; WebSocket `/ws` sự kiện `trip.event` |
| Lịch sử | Trip `GET /trips/history` (cursor) |
| Vẽ tuyến, dẫn đường | Routing R02 `POST /routes`, R04 `POST /routes/recalculate` (`includeSteps=true`) hoặc OSRM trực tiếp khi phát triển |
| Tìm địa điểm | Photon (OpenStreetMap) nếu đặt `EXPO_PUBLIC_GEOCODER_URL`; hệ thống chưa có dịch vụ geocoding. Không có thì dùng geocoder của hệ điều hành để đặt tên điểm GPS |

Trạng thái chuyến: WebSocket `/ws` (xác thực bằng tin nhắn `auth` đầu tiên, ping 25 giây, gia hạn token trước khi hết hạn, tự kết nối lại) chỉ báo có thay đổi; app luôn đọc lại qua API, bỏ bản có `version` cũ hơn và đọc lại `GET /trips/active` sau mỗi lần kết nối lại. Mất WebSocket thì polling 10 giây.

Lỗi có hai dạng: User Service trả `{code, message, fieldErrors}`, các service còn lại và gateway trả `{error: {code, message, details}, meta}`. Client xử lý cả hai.

## 5. MapLibre Navigation SDK (Android)

### 5.1 Phụ thuộc

| Thành phần | Phiên bản | Ghi chú |
| --- | --- | --- |
| `org.maplibre.navigation:navigation-ui-android` | 5.0.0 (08/2026) | Kéo theo `navigation-core` (Kotlin Multiplatform) |
| `org.maplibre.gl:android-sdk-opengl` | 13.6.1 | Trùng bản MapLibre React Native 11.5 dùng |
| `androidx.appcompat:appcompat` | 1.7.0 | |

- SDK phụ thuộc `org.maplibre.gl:android-sdk:13.5.0`, còn MapLibre React Native dùng `android-sdk-opengl`. Hai artifact chứa cùng các lớp `org.maplibre.android.*`, nên `build.gradle` của module loại `android-sdk` khỏi cây phụ thuộc của SDK.
- SDK được biên dịch bằng Kotlin 2.4, còn React Native 0.86 dùng Kotlin 2.1.20 (chỉ đọc được metadata tới 2.2). Phần gọi SDK viết bằng Java; module và `:app` bật `-Xskip-metadata-version-check`. Cờ cho `:app` do `modules/chande-navigation/app.plugin.js` thêm khi prebuild. **Đây là điểm rủi ro nhất khi build lần đầu.**

### 5.2 Luồng chạy

1. JS lấy tuyến (`createRouteProvider` → routing-service hoặc OSRM), chuẩn hoá về `PlannedRoute`.
2. `toDirectionsRoute` dựng JSON đúng model `DirectionsRoute` của SDK.
3. `ChandeNavigation.start({ routeJson, simulate })` mở `ChandeNavigationActivity` (`NavigationView` của SDK, theme teal).
4. Activity gửi sự kiện về JS: `onRunning`, `onProgress` (quãng đường/thời gian còn lại), `onOffRoute`, `onArrival`, `onEnded` (`cancelled`/`arrived`/`error`).
5. Khi lệch tuyến, SDK **không** tự gọi Directions API (`allowRerouteFrom` trả `false`). JS gọi routing-service R04 từ vị trí hiện tại rồi `ChandeNavigation.updateRoute(json)`.
6. Đến nơi: Activity tự đóng sau 3 giây và trả `onEnded { reason: "arrived" }`.

`simulate: true` dùng `ReplayRouteLocationEngine` của SDK để chạy giả lập dọc tuyến, tiện thử trên emulator.

### 5.3 Yêu cầu với JSON tuyến

Rút ra từ mã nguồn SDK 5.0.0; vi phạm thì SDK ném lỗi hoặc crash:

- `routeOptions` bắt buộc có `voice_instructions: true` và `banner_instructions: true` (milestone mặc định).
- Hình học tuyến và từng bước là polyline độ chính xác 6.
- `maneuver.type`/`modifier` phải thuộc enum của SDK; giá trị lạ làm parse thất bại.
- Mỗi bước cần `bearing_before`, `bearing_after` và **ít nhất một** `intersections`.
- Banner của bước i mô tả thao tác cuối bước (thao tác của bước i + 1). Bước ngay trước điểm đích có hai banner; banner cuối là tín hiệu "đã đến nơi" của SDK.
- Câu chỉ dẫn và giọng đọc tiếng Việt do app sinh (routing-service đang trả `instruction = null`); `voiceLocale = "vi"` để TTS Android đọc tiếng Việt.

routing-service không trả hình học từng bước: app cắt polyline tổng theo vị trí thao tác. Đã kiểm với tuyến OSRM thật ở Hà Nội: cắt lại khớp từng bước (lệch 0 m).

### 5.4 iOS và web

Không có SDK native. Màn dẫn đường dùng `RouteTracker` (`src/features/navigation/progress.ts`): bản đồ, tuyến, vị trí hiện tại, bước kế tiếp và danh sách chỉ dẫn; lệch tuyến > 50 m ba lần liên tiếp thì tính lại.

## 6. Cấu hình

Sao chép `rider.env.example` vào `app/.env.local` (đã gitignore). Mọi biến `EXPO_PUBLIC_*` đều công khai trong bundle: không đặt khoá dịch vụ.

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `EXPO_PUBLIC_API_BASE_URL` | — (bắt buộc) | Gốc API Gateway, ví dụ `http://192.168.1.10:8080` (emulator Android: `http://10.0.2.2:8080`) |
| `EXPO_PUBLIC_API_PREFIX` | `/api/v1` | Prefix của gateway |
| `EXPO_PUBLIC_API_WS_PATH` | `/ws` | WebSocket trạng thái chuyến; để trống thì chỉ polling |
| `EXPO_PUBLIC_HTTP_TIMEOUT_MS` | `10000` | 1000–60000 |
| `EXPO_PUBLIC_RIDER_TRIP_POLL_MS` | `10000` | Chu kỳ đọc lại chuyến khi mất WebSocket |
| `EXPO_PUBLIC_RIDER_VEHICLE_TYPES` | `BIKE,CAR_4,CAR_7` | Loại xe báo giá; loại nào Routing/Price chưa hỗ trợ sẽ hiện "chưa có giá" |
| `EXPO_PUBLIC_MAP_STYLE_URL` | OpenFreeMap Liberty | Style MapLibre |
| `EXPO_PUBLIC_MAP_CENTER` | `105.8542,21.0285` | Tâm mặc định `lng,lat` |
| `EXPO_PUBLIC_GEOCODER_URL` | — | Photon, ví dụ `https://photon.komoot.io` (máy chủ công khai chỉ để thử) |
| `EXPO_PUBLIC_ROUTING_MODE` | `gateway` | `gateway` hoặc `osrm` |
| `EXPO_PUBLIC_ROUTING_BASE_URL` | `<API_BASE_URL><API_PREFIX>/routing` | Gốc routing-service qua gateway; app gọi `/routes` và `/routes/recalculate` |
| `EXPO_PUBLIC_OSRM_BASE_URL` | — | OSRM tự host khi `ROUTING_MODE=osrm`, ví dụ `http://10.0.2.2:5000` |
| `EXPO_PUBLIC_OSRM_PROFILE` | `driving` | Profile OSRM |
| `EXPO_PUBLIC_ROUTING_VEHICLE_TYPE` | — | Ép loại xe gửi routing-service (ví dụ `CAR` khi chưa có profile xe máy) |
| `EXPO_PUBLIC_ROUTING_TIMEOUT_MS` | `10000` | 1000–60000 |

App tài xế vẫn dùng các biến trong `driver.env.example` và `realtime.env.example`. Style bản đồ của màn dẫn đường native đặt qua prop `mapStyleUrl` của plugin trong `app.json` (mặc định OpenFreeMap Liberty).

## 7. Chạy và build

```bash
npm install
cp rider.env.example .env.local
npx expo run:android
```

- `npm install` cài thêm `@maplibre/maplibre-react-native`, `maplibre-gl`, `@expo-google-fonts/inter`, `@types/geojson` và cập nhật `package-lock.json` (chưa cập nhật trong repo).
- MapLibre React Native và module dẫn đường là mã native: cần development build (`npx expo run:android` với Android SDK, hoặc `eas build --profile development`); không chạy trong Expo Go.
- Thử dẫn đường trên emulator: nhận một chuyến ở app tài xế → "Chuyến hiện tại" → "Dẫn đường đến điểm đón" → "Chạy giả lập dọc tuyến".
- Web (`npx expo start --web`) cần gateway cho phép origin `http://localhost:8081` trong `cors.allowed-origins`; hiện gateway chỉ mở `localhost:5500`.
- OSRM local chỉ publish `127.0.0.1:5000`: emulator Android dùng `10.0.2.2:5000`, máy thật cần mở cổng ra LAN.

## 8. Kiểm thử đã làm

Máy phát triển chưa có Node, Android SDK, Xcode, nên chưa chạy app hay build được. Thay vào đó dùng TypeScript 6.0.3 (cùng bản dự án) chạy trong JavaScriptCore có sẵn của macOS:

| Kiểm tra | Kết quả |
| --- | --- |
| Typecheck toàn bộ `app/` (123 file) với `tsconfig.json` của dự án và type thật của các gói (React Native 0.86.3, Expo 57, expo-router, MapLibre RN 11.5, maplibre-gl 5.24…) | 0 lỗi; thêm `noUnusedLocals` vẫn 0 lỗi. Đã thử chèn lỗi cố ý để chắc bộ kiểm bắt được |
| Lõi dẫn đường với tuyến OSRM thật Hồ Gươm → Keangnam (9,5 km, 23 bước) | Mã hoá lại polyline khớp từng ký tự; JSON `DirectionsRoute` đủ cờ, banner/giọng đọc hợp lệ; cắt bước kiểu routing-service lệch 0 m; `RouteTracker` báo đến nơi trong 45 m cuối và phát hiện lệch tuyến |
| Logic app khách (41 kiểm tra, client giả) | Định dạng VND/km/phút; JWT; decode; lỗi HTTP hai định dạng; 401 → làm mới token → gửi lại; refresh lỗi thì kết thúc phiên; báo giá từng loại xe và tự chọn loại; thử lại tạo chuyến dùng lại `Idempotency-Key`; chuyến không lùi `version`; huỷ thử lại dùng lại khoá; phát hiện chuyến đã kết thúc |
| WebSocket `/ws` (12 kiểm tra, socket giả) | Gửi `auth` đầu tiên, `auth.ok` → live, ping, hẹn gia hạn trước hạn 1 phút, nhận `trip.event`, mất kết nối → chờ 2 giây rồi kết nối lại, dừng sạch |
| Phiên dẫn đường native (10 kiểm tra, module giả) | Lệch tuyến → một yêu cầu R04 duy nhất → `updateRoute`; không tính lại sau khi đến nơi; gỡ listener khi kết thúc |
| Tên icon và đường dẫn | 48 icon hợp lệ cả Material Symbols lẫn SF Symbols; mọi `href` trỏ tới route có thật |

Chưa kiểm: giao diện chạy thật, build Android, Kotlin/Java của module (chỉ đối chiếu với mã nguồn SDK 5.0.0).

## 9. Việc còn lại

- [ ] `npm install` để cập nhật `package-lock.json`, rồi `npx expo lint`.
- [ ] Build Android (`npx expo run:android`) và chạy thử: đặt chuyến end-to-end qua gateway, dẫn đường ở chế độ giả lập.
- [ ] Gateway: thêm `http://localhost:8081` vào CORS để chạy bản web; nối route R02/R04 của routing-service.
- [ ] iOS: dẫn đường native bằng `maplibre-navigation-ios` (hiện dùng bản dự phòng).

## 10. Rủi ro và điểm cần nhóm chốt

| Vấn đề | Ảnh hưởng | Đề xuất |
| --- | --- | --- |
| Gateway chưa nối routing-service: `/api/v1/routing/**` chuyển thành `/routing/...` trong khi routing-service phục vụ `/routes`, và cần `X-Service-Token` của gateway | Chế độ `gateway` chưa lấy được tuyến | Dùng `ROUTING_MODE=osrm` khi phát triển; nhóm gateway thêm route R02/R04 |
| OSRM local chỉ có profile ô tô | Tài xế xe máy (`BIKE`) không có tuyến qua routing-service | Tạm dùng `EXPO_PUBLIC_ROUTING_VEHICLE_TYPE=CAR` |
| Khách không nhận được vị trí tài xế (gateway chỉ đẩy `trip.event`) | Màn theo dõi chuyến không vẽ được xe tài xế | Cần sự kiện vị trí tài xế cho khách nếu muốn hiển thị |
| Không có dịch vụ thanh toán/khuyến mãi | Bỏ phần khuyến mãi, thanh toán hiển thị "Tiền mặt" | |
| Kotlin 2.1 đọc thư viện Kotlin 2.4 bằng `-Xskip-metadata-version-check` | Có thể lỗi biên dịch ở lần build đầu | Nếu lỗi: nâng `android.kotlinVersion` lên 2.3.x qua `expo-build-properties` |
