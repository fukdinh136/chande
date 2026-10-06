# MapLibre cho bản đồ và điều hướng Android

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Customer App / Driver App |
| Rà soát | 2026-10-06 |
| Quy ước | [Format và số liệu](../quy-uoc-tai-lieu.md) |

## Trạng thái thực thi hiện tại

Các mô tả dưới đây là thiết kế đích. Đã triển khai từng phần kết nối trong app/; trạng thái, commit, kiểm thử và giới hạn APK/native được ghi tại [báo cáo thực thi](bao-cao-ket-noi.md). Shared-source Android variants hiện dùng com.chande.customer/com.chande.driver; workspace mobile riêng vẫn là đề xuất.

Người dùng chọn MapLibre Navigation SDK và demo Android. Không thay thành Google Maps/Mapbox hoặc engine khác trong thiết kế. Tài liệu là kiến trúc/gate để triển khai, chưa cài package, build APK hoặc kiểm chứng native navigation.

## Ba thành phần riêng

| Thành phần | Dùng ở đâu | Trách nhiệm |
| --- | --- | --- |
| MapLibre React Native renderer | Customer + Driver | Basemap, layers/route/pins, camera, gestures; không tự có navigation engine |
| MapLibre Navigation Android core | Driver | Route progress, maneuver/off-route/arrival qua NativeNavigationPort |
| Routing/OSRM | Backend | Tính đường/ETA; Gateway credential, queue/limiter/deadline; không tiles/geocoding |

Renderer docs hiện yêu cầu RN>=0.80 và v11 dùng New Architecture; package app đang RN0.86.3/Expo57 nên là candidate, chưa là chứng nhận tương thích. MapLibre cần development build và config plugin, không Expo Go. [Requirements](https://maplibre.org/maplibre-react-native/docs/setup/getting-started/), [Expo setup](https://maplibre.org/maplibre-react-native/docs/setup/expo/).

Android repository hiện công bố core/UI 5.0.0-pre13, đang chuyển KMP. Chọn native-core làm candidate cho spike; không kéo UI SDK che bố cục Stitch. Khoá artifact/version/checksum và Gradle dependency graph sau proof; không gọi prerelease là stable hoặc hạ RN một cách tự động. [MapLibre Navigation Android](https://github.com/maplibre/maplibre-navigation-android). iOS/KMP iOS/Ferrostar không thuộc demo này.

## Native bridge đề xuất

Expo Module Kotlin riêng cho Android, TS façade và config plugin trong mobile/packages/navigation-native. Không chỉnh generated android/ của app tay. [Expo Modules](https://docs.expo.dev/modules/overview/) là cơ chế bridge đề xuất, không phải package navigation RN đã có sẵn trong repo.

```text
NativeNavigationPort (interface frontend, không phải tên API SDK):
  capabilities(): {navigation, rawLocation, progress, reroute, voice}
  initialize(config) / dispose()
  start({sessionId, tripId, phase: TO_PICKUP|TO_DESTINATION, route})
  replaceRoute({sessionId, revision, route}) / stop(sessionId)
  subscribeRawLocation(listener)
  subscribeProgress(listener)
  subscribeOffRoute(listener) / subscribeArrival(listener)
```

Progress event normalized local: sessionId,routeRevision,remainingDistanceMeters,remainingDurationSeconds,nextManeuver?,distanceToManeuverMeters?,positionMatched?,speedMetersPerSecond?,observedAt. Không là Trip event, không lưu backend fare hoặc status. Missing speed/limit/voice là null/disabled; không hard-code “Tối đa 50” hoặc voice guidance giả.

Điều hướng hiện bằng camera/route/position trong MapLibre RN và React Native HUD theo Stitch; core bridge không sở hữu màn login/sheet/action Trip. Nếu SDK/RN native MapLibre dependencies đụng version/ABI, spike phải giải quyết deduplication hoặc dùng một native map view duy nhất, không embed hai MapView chồng nhau để che lỗi.

## Gap route đã xác minh từ code

R02/R04 trả một geometry tổng polyline6 và flat steps distance/duration/streetName/maneuver. [OsrmProvider](../../service/routing-service/src/infrastructure/map/osrm.ts) schema không giữ step.geometry hoặc leg distance/duration/summary/intersections. Chỉ gọi includeSteps=true không sửa sự thiếu hụt này.

SDK source snapshot `f9b73d16f4228050fe0fe6aa93be46a3fe36673a` có DirectionsRoute geometry/legs/distance/duration và LegStep geometry bắt buộc. [DirectionsRoute](https://github.com/maplibre/maplibre-navigation-android/blob/f9b73d16f4228050fe0fe6aa93be46a3fe36673a/maplibre-navigation-core/src/commonMain/kotlin/org/maplibre/navigation/core/models/DirectionsRoute.kt), [LegStep](https://github.com/maplibre/maplibre-navigation-android/blob/f9b73d16f4228050fe0fe6aa93be46a3fe36673a/maplibre-navigation-core/src/commonMain/kotlin/org/maplibre/navigation/core/models/LegStep.kt), [RouteFetcher](https://github.com/maplibre/maplibre-navigation-android/blob/f9b73d16f4228050fe0fe6aa93be46a3fe36673a/maplibre-navigation-core/src/commonMain/kotlin/org/maplibre/navigation/core/route/RouteFetcher.kt).

Suy luận thiết kế: adapter không được bịa step geometry, đoán chia route line theo maneuver gần nhất, lấy toàn geometry tổng cho mọi step hoặc gửi DTO preview vào fromJson rồi coi là navigation route. Phải có rich-route contract, custom fetcher và parser cụ thể của artifact đã pin. Giữ nguyên R01 strict hai fields của Trip và R02/R04 hiện tại.

## R05 bổ sung tối thiểu — DRAFT, chưa có handler

| Thuộc tính | Contract đề xuất để validate ở feature riêng |
| --- | --- |
| Service / public path | Routing POST /routes/navigation; Gateway POST /api/v1/routes/navigation |
| Caller/auth | DRIVER JWT tại Gateway; Gateway Routing credential nội bộ, scope R05 mới; không public matrix |
| Input | origin,destination,vehicleType CAR_4/CAR_7; không caller URL/key hoặc vehicle change từ client giữa Trip |
| Success | 200 Node envelope; data schemaVersion1,provider OSRM,vehicleType,geometryPrecision6,calculatedAt,directions payload |
| Directions | Một route đầu; route geometry/distance/duration; đầy đủ leg summary/distance/duration/steps; step geometry/distance/duration/name/maneuver/intersections nếu có; snap waypoints và options phục vụ reroute |
| Mapping | OSRM route/v1 driving, alternatives=false,overview=full,geometries=polyline6,steps=true; preserve doubles cho SDK; filter/validate fields trước normalize vào native DTO |
| Limits/errors | Dùng lại queue/limiter/global4s/response cap; 400 input/type,422 no route,503 busy/dependency/schema; không bypass quota bằng mobile gọi OSRM |
| Existing consumers | Không thêm trường/đổi R01 hoặc tính lại quote/fare; DTO richer là contract mới |

```json
{
  "origin": {"lat": 21.0295, "lng": 105.8542},
  "destination": {"lat": 21.0285, "lng": 105.8542},
  "vehicleType": "CAR_4"
}
```

```text
data: {
  schemaVersion: 1, provider: OSRM, vehicleType: CAR_4,
  geometryPrecision: 6, calculatedAt: UTC,
  directions: {code: Ok, routes: [richRoute], waypoints: [snappedOrigin, snappedDestination]}
}
```

Response trên là pseudocode draft, không payload SDK đã nghiệm thu. Exact schema của SDK route/options/maneuver phải khóa với spike; không phụ thuộc fromJson chấp nhận unknown OSRM fields. backend R05 chưa triển khai; app loader capability mặc định false. Navigation yêu cầu người dùng không được silently skip rồi báo đã dùng SDK; cần feature nhỏ này + native proof trước full demo.

Nếu muốn giữ backend không đổi, có thể demo renderer/preview và UI trạng thái bằng R02/R04, nhưng không đáp ứng điều kiện nghiệm thu turn-by-turn. Không đổi sang Directions API thương mại hoặc thêm Valhalla trong thiết kế này.

## Routing/nav hai chặng và reroute

ASSIGNED: origin raw GPS hiện tại → pickup; đến gần pickup SDK onArrival chỉ gợi ý xác nhận DRIVER_ARRIVED. Sau đó chờ user START; IN_PROGRESS xin route GPS/pickup → trip.destination. COMPLETED/CANCELLED/assignment khác phải stop engine, clear callbacks/session; không đọc GPS rồi tự complete, không so tọa độ để bypass Trip version.

SDK custom RouteFetcher thông báo offRoute cho JS coordinator, JS gọi Gateway bằng session transport, decoder mapping rồi replaceRoute với sessionId/revision. Không route fetch mặc định tới Mapbox/OSRM private, không đặt JWT/service credential trong URL. Request cũ đến sau phase change/cancel bị discard. Off-route proposal: một request in-flight, debounce1s, tối thiểu5s giữa lần recalculation thành công; backoff lỗi, không publish lại fare. Đây là client defaults cần đo trong Android spike.

Preview/route recalculated có thể khác route summary đã chốt; UI labels tách ETA hiện tại với distance/fare Trip. Không dùng native remaining distance để sửa finalAmount. Không có traffic realtime hoặc speed-limit dataset được nghiệm thu.

## Location ownership và foreground demo

Một LocationCoordinator là nguồn authoritative cho UI/native/publisher. Trước native integration dùng Expo foreground provider như app hiện có; khi engine cần own location, switch provider có cleanup/epoch, nhận raw callbacks hoặc inject provider đã kiểm. SDK/map có thể có nội bộ subscribers, nhưng app chỉ một publisher và không hai stream “thắng nhau”. Map user marker/camera đi từ coordinator, không bật một location publisher thứ hai trong renderer.

Raw sample giữ GNSS/platform timestamp/accuracy, optional bearing/speed chỉ UI/native. GPS snapped dùng progress, không gửi server với accuracy giả. Server wire chỉ latitude/longitude/accuracy/recordedAt, default publisher10s/freshness30s/future5s/maxAccuracy100m. GPS failure không biến thành position0,0 hoặc coordinate fixture.

Foreground toàn authenticated Driver app, không gắn dashboard focus. Desired ONLINE + selection/profile đủ hoặc active assigned Trip là điều kiện UI publish; backend UpdateLocation xác thực Driver/GPS, nearby vẫn lọc eligibility qua Driver. OFFLINE không hủy Trip; native local navigation có thể tiếp tục cho active Trip. Khi background demo pause engine/publisher/socket; sau foreground refresh active state rồi resume đúng phase. Không hứa background/lock-screen navigation.

Location denied: Customer vẫn chọn pin; Driver không báo GPS ready/nhận cuốc thật từ sample cũ, giải thích quyền và intent. Accuracy null/coarse: navigation unavailable/uncertain, không giả high accuracy. GPS timestamps bị server reject: show clock issue, không đổi recordedAt để vượt freshness. [Expo Location SDK57](https://docs.expo.dev/versions/v57.0.0/sdk/location/).

## Basemap/tiles và Android spike

Style.json/tiles/sprites/glyphs coverage Hà Nội là dependency riêng. OSRM PBF/graph không phải vector tile server. Provider chưa được chốt: dùng configured style đã xác nhận coverage/attribution; demo tiles chỉ smoke renderer, không chứng minh map Hà Nội hữu dụng. Địa chỉ autocomplete/reverse-geocode/POI skip, manual pin/saved coords đủ flow demo.

Gate F01: clean Android native build (Expo57/RN0.86.3 + MapLibre RN candidate + Navigation core), map actual Hà Nội, rich-route parse từ fixture thật/SDK model, raw GPS/progress callbacks, arrival/off-route/custom reroute, observer disposal và dependency/ABI tree. Kiểm chạy device/emulator, runtime permissions, debug HTTP; không chỉ tsc, Web hoặc Expo Go. Không cần SDK voice cho demo; có visual maneuver/progress mới là navigation gate.

Chưa chốt tile/style provider hoặc artifact native final. Đây là input cấu hình/spike, không lý do bịa API/giá/dữ liệu hoặc thay yêu cầu MapLibre của người dùng.
