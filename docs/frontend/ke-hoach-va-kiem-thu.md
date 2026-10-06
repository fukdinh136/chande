# Kế hoạch triển khai và nghiệm thu Android

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Customer App / Driver App |
| Rà soát | 2026-10-06 |
| Quy ước | [Format và số liệu](../quy-uoc-tai-lieu.md) |

## Trạng thái thực thi hiện tại

Các mô tả dưới đây là thiết kế đích. Đã triển khai từng phần kết nối trong app/; trạng thái, commit, kiểm thử và giới hạn APK/native được ghi tại [báo cáo thực thi](bao-cao-ket-noi.md). Shared-source Android variants hiện dùng com.chande.customer/com.chande.driver; workspace mobile riêng vẫn là đề xuất.

Kế hoạch bên dưới mô tả đích triển khai; các feature đã thực thi xem báo cáo kết nối. Android only, hai APK. Backend Docker/Kubernetes smoke đã có nhưng không thay APK/device tests. Chức năng skip không nằm trong acceptance app v1; MapLibre Navigation vẫn phải qua native/rich-route gate để gọi là hoàn thành.

## Feature theo thứ tự dependency

| Feature | Deliverable | Gate / kiểm thử |
| --- | --- | --- |
| F00 | Bộ tài liệu phạm vi/UI, API, C4/C3, native mapping và skip register | Đã tạo trong đợt thiết kế; người dùng review các mặc định đề xuất |
| F01 | Android native spike độc lập: Expo57/RN0.86, MapLibre renderer + navigation-core, bridge | Pin SDK sau Gradle clean build, actual devices/emulator, no duplicate native libraries; route fixture đầy đủ step geometry parse/progress |
| B01 | Minimum backend R05 navigation draft sau khi chốt SDK model | Routing preserves rich OSRM fields, Gateway DRIVER-only/new token scope, unchanged R01/R02/R04; auth/deadline/schema/route fixtures, no private token mobile |
| F02 | Mobile workspace riêng, hai apps/router, shared design-system/contracts, config/capability loader | Hai Android package IDs, no Customer→Driver module import, no duplicated React/RN; old app/ vẫn chạy trước cutover |
| F03 | Customer auth/profile/saved places; Driver OTP/profile/vehicles/availability; session/cache | Raw vs envelope,204, refresh race/logout epoch, no default role confusion, partial sync/error/form validation |
| F04 | Map/pin/preview/quote/create/cancel, customer active/history | Tiles Hà Nội/attribution, polyline6 lng/lat, quotes per type, late request discard, price string/expire/create replay |
| F05 | Trip /ws + Driver Socket.IO app-scope providers, foreground GPS | Auth/refresh/reconnect, no duplicate socket/publisher, callbacks outside dashboard tab, stale/future/permission failures |
| F06 | Driver offer modal + decisions + state reconciliation | Server 20s, accept202 pending, ownership, duplicate/reordered/revoked offers, no repeat invite assumption UI |
| F07 | Native nav two phases/reroute + Trip actions | Phụ thuộc F01/B01; local SDK progress != Trip status, cancellation stop, stale route discard, no fare mutation |
| F08 | Restyle/history/profile, accessibility, final two-APK flow/smoke/report | Actual Stitch hierarchy and real data; remove skipped controls; Android e2e and artifact installation |

Có thể làm F03/F04/F05 khi native gate còn xử lý; không làm giả navigation để unblock F07. Không nâng stack backend/bổ sung geocoding/payment/GPS Customer để mở rộng scope. R05 là bổ sung tối thiểu phục vụ yêu cầu SDK, không cam kết đã implement hoặc người dùng đã duyệt exact DTO.

## Ma trận kiểm thử

| Nhóm | Kịch bản | Kết quả cần đạt |
| --- | --- | --- |
| Contracts | User raw/Node envelope, empty204, malformed, extra/missing fields, nested detail | Decoder đúng endpoint, contract error rõ, không false-empty |
| Auth | Hai role, concurrent refresh, old401, logout while refresh/request/socket, auth wrong aud | Một rotation/app, revoke/reset đúng, old epoch không phục hồi phiên |
| Booking | Input đổi trong khi quote request, quote5min boundary, create timeout then expiredquote, active conflict | Không dùng quote stale; same key/body replay; không tạo thêm chuyến |
| Commands | Double tap, replay stale snapshot, version409, cancel race Driver start | Đọc lại theo intent; không rollback cache/version hoặc auto new key |
| Money/UI | Decimal-string >2^53, final null, completed/cancelled, no payment field | Không mất precision, không gọi estimatedFare là thu nhập net/đã thanh toán |
| Offer | 20s vs prototype10s; expires clock skew; accept202; callback delay/reject/cancel | Pending UI đúng, không autoASSIGNED, no timer reset/reaccept terminal |
| Realtime | Duplicate/order gaps, lost/trip events, socket reconnect/expiredJWT, switch tabs | Refetch authoritative, single streams, no false trip driver GPS |
| GPS | Denied/disabled/coarse/nullaccuracy, stale/future, frame interrupted, background/foreground | Không coordinate giả, no stale replay, active Trip không tự canceled, app scope không tab-only |
| Maps | Longitude/latitude swap, precision5 vs6, fitBounds/sheet drag, tiles offline/provider error | Marker đúng Hà Nội, geometry tests, attribution/camera visible, graceful offline |
| Native nav | Parse required fields, real/simulated GPS, step/progress, reroute response after phase change | SDK engine thực chạy, no private backend calls, disposal/no leaking observers |
| Lifecycle | Screenlock/background, terminal Trip during navigation, lostselection/restart app | Foreground limit honest, stop nav on terminal, hydrate/cache gate before commands |
| UI/UX | Long address/name/VND, font scale, keyboard, small/large Android, touch48dp, state errors | Không clipping/overlap/hit target nhỏ; skip features absent, no prototype data in real mode |

Jest/React Native Testing Library hoặc equivalent được chọn lúc F02; pure ports/commands/decoders unit, mocked websocket contracts, native instrumentation/emulator tests và APK end-to-end riêng. Unit/contracts và live smoke cho phần kết nối đã chạy; native/device tests chưa chạy, xem báo cáo. Không tự ghi hàng trăm test mirror component chỉ để có số lượng.

## Demo bằng hai app Android

1. Bật backend local đã có; nối emulator về host Docker18080 hoặc kube18081. Khóa tiles/style config và backend CAR_4/CAR_7, mock OTP account riêng; fixture phone/vehicle chỉ dành demo, không seed DB chung.
2. Customer APK: register/login → map pin/saved places Hà Nội → preview → quote → create. SEARCHING dùng server status, không synthetic drivers/arrival countdown.
3. Driver APK: OTP login → profile/vehicle selection → ONLINE + foreground GPS. Nhận offer thật qua Socket.IO → accept REST → UI pending → Trip ASSIGNED.
4. Driver SDK route TO_PICKUP/progress/arrival suggestion → user confirm DRIVER_ARRIVED → IN_PROGRESS → TO_DESTINATION → user complete. Customer /ws/refetch trạng thái/snapshot; fare fixed và history.
5. Chuyến kế: Customer cancel hoặc Driver cancel trước IN_PROGRESS, nav dừng, reservation release, không rematch. Decline/expiry: offer tiếp theo thuộc backend; search vẫn tồn tại.
6. Mất mạng/refresh, close/reopen APK, switch tab foreground và restart backend → state hydrate, no duplicate create/decision/patch. Background hạn chế phải hiện đúng, không giả notification.

Nếu máy Windows chỉ có một emulator, chạy tuần tự role/account hoặc hai emulator; vẫn hai APK khác application ID, không một màn chọn role. Native SDK proof dùng emulator hoặc device; simulated route fixture được đánh dấu test, không gửi simulator vị trí cũ vào real availability.

## Build/config gate

Theo app/AGENTS.md hiện tại và docs Expo đúng major. Khi thực thi sau này: install native modules qua expo install, config plugins/local Expo Modules, CNG; không chỉnh generated android bằng tay. Ví dụ deferred commands sau khi workspace/package đã tạo:

```powershell
Set-Location mobile/apps/driver-app
npx.cmd expo install @maplibre/maplibre-react-native
npx.cmd expo run:android
npx.cmd tsc --noEmit
npx.cmd expo lint
```

Expo run:android cần Android toolchain được chuẩn bị; EAS development build/APK là phương án khác, chưa upload/sign/build cloud trong đợt thiết kế. Không thêm native lib rồi dùng expo start --android/Expo Go để claim build proof. Exact minSdk/compileSdk/targetSdk theo Expo57 và resolved SDK constraint, không áp23 chỉ vì renderer hỗ trợ23. [Development builds](https://docs.expo.dev/develop/development-builds/introduction/).

Mỗi feature triển khai sau này có checks phù hợp, commit nhỏ, cập nhật API/skip/capabilities và báo cáo pass/fail/skip + emulator/device/build provenance. APK Customer không chứa Driver signing/service credential; không commit keystore/private env. Android release/app store/production, iOS, background nav/push chưa nằm trong demo này.

## Các điểm review còn lại

Default đã đề xuất: workspace mobile riêng, hai demo IDs, YAML design tokens, foreground-only, polling/throttle values. Chưa xác nhận provider style/tiles/glyphs/sprites và artifact Navigation final. F01 kiểm build/ABI/route schema để khóa kỹ thuật, B01 xác nhận DTO mới. Đây là phần cần validate trước implementation, không phải API hoặc native capabilities đã có.
