# Velox Customer / Driver — kết nối backend

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Customer App / Driver App |
| Rà soát | 2026-10-06 |
| Quy ước | [Format và số liệu](../docs/quy-uoc-tai-lieu.md) |

Expo57 / React Native0.86.3 / React19.2.3 / TypeScript6.0.3, Android demo. [Báo cáo kết nối](../docs/frontend/bao-cao-ket-noi.md) ghi feature/commit, API smoke thật, CI, runbook và giới hạn nghiệm thu. [Thiết kế đích](../docs/frontend/README.md) mô tả UI Stitch, API và kiến trúc/native còn cần hoàn thiện.

[Rà soát và demo Kubernetes](../docs/bao-cao-demo-kubernetes.md) ghi trạng thái mới nhất: demo web, tài khoản Customer lưu PostgreSQL và kiểm thử navigation với OSRM thật.

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
$env:APP_VARIANT='customer' # hoặc driver
$env:EXPO_PUBLIC_LOCAL_DEMO='true'
npx.cmd expo start
```

Development tự tìm Gateway local Docker18080 hoặc Kubernetes18081. Android emulator dùng10.0.2.2; web/adb reverse dùnglocalhost. Xem các biến public ở [.env.integration.example](.env.integration.example); không ghi đè env local hoặc đưa service credentials vào app. URL EXPO_PUBLIC_BACKEND_ORIGIN explicit được ưu tiên; production cần HTTPS explicit.

Android: `npm ci` tự chạy [bản vá MapLibre 11.5.0](scripts/patch-maplibre-geojson.cjs) để tương thích GeoJSON/Turf 7 đang được chọn cho navigation SDK. Bản vá chỉ đổi helper tạo geometry collection sang danh sách chỉ đọc và bỏ geometry null khi tính bounds; không sửa renderer, API map hoặc cấu hình service. Nếu cài với `--ignore-scripts`, chạy `npm run postinstall` trước khi build. Script dừng với lỗi khi phiên bản/source upstream khác dự kiến; cần review lại khi nâng MapLibre. Không sửa tay `node_modules` hoặc thư mục Android sinh bởi Expo.

Dùng JDK 17 cho Android build (`JAVA_HOME` trỏ tới thư mục JDK 17, thêm `JAVA_HOME/bin` vào đầu `PATH`). Gradle 9.3.1 chạy được bằng Java 25, nhưng Prefab 2.1.0 của Android toolchain hiện tại coi cảnh báo native access trên Java 25 là lỗi khi configure CMake. Phiên bản JBR đi kèm Android Studio mới có thể là Java 25; cần kiểm tra bằng `java -version` thay vì mặc định dùng JBR.

Windows: nếu Metro với `--localhost` chỉ nghe `::1:8081`, Android/ADB không tải được bundle qua IPv4. Trong terminal đã cấu hình Driver (`APP_VARIANT=driver` và các origin demo), chạy `node --dns-result-order=ipv4first ./node_modules/expo/bin/cli start --dev-client --localhost --port 8081`. Kiểm tra `http://127.0.0.1:8081/status` trả `packager-status:running`, nối `adb reverse tcp:8081 tcp:8081`, rồi mở app debug đã cài. Giữ Metro chạy trong khi demo; APK debug không chứa bundle offline.

Hai CNG variants: com.chande.customer và com.chande.driver, scheme và entry guards riêng; chạy đúng Metro/variant với dev build tương ứng. Combined mặc định dùng để kiểm tra hai role trong source chung. Không chỉnh android/ios generated thủ công. Source hiện có MapLibre renderer, pin/tuyến, navigation module và UI mới; native APK/navigation trên thiết bị chưa nghiệm thu. Web dùng renderer OSM riêng. Kết quả Android bundle và lần build NDK trước được giữ trong báo cáo kết nối lịch sử.

Live API tests ghi dữ liệu: dùng stack disposable riêng từ [harness Driver](../service/driver-service/docs/deploy.md#stack-xác-minh-tích-hợp-riêng), không dùng database của nhóm hoặc production:

```powershell
$env:APP_INTEGRATION='1'
$env:DRIVER_APP_INTEGRATION='1'
$env:DRIVER_TEST_STORAGE_ACK='ISOLATED_DRIVER_TEST_ONLY'
$env:APP_BACKEND_URL='http://127.0.0.1:18082'
npm.cmd test
Remove-Item Env:APP_INTEGRATION
Remove-Item Env:DRIVER_APP_INTEGRATION
Remove-Item Env:DRIVER_TEST_STORAGE_ACK
```

Suite mặc định gồm test client và Driver session/offer/resource/socket/GPS/navigation/form/shell, với 5 test live bị tắt. Driver live dùng chính adapter/coordinator để kiểm tra assignment đúng trip/driver/vehicle → hoàn thành → lịch sử. Booking smoke kiểm tra hủy/release reservation; rich route kiểm tra OSRM thật và quyền DRIVER. Native modules, SecureStore và map host được mock trong test React/lifecycle; GPS live dùng tọa độ fixture. Các test này không phải Android/iOS UI E2E hoặc nghiệm thu GPS cảm biến/navigation native.
