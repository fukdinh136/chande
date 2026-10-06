# Velox Customer / Driver — kết nối backend

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Customer App / Driver App |
| Rà soát | 2026-10-06 |
| Quy ước | [Format và số liệu](../docs/quy-uoc-tai-lieu.md) |

Expo57 / React Native0.86.3 / React19.2.3 / TypeScript6.0.3, Android demo. [Báo cáo kết nối](../docs/frontend/bao-cao-ket-noi.md) ghi feature/commit, API smoke thật, CI, runbook và giới hạn nghiệm thu. [Thiết kế đích](../docs/frontend/README.md) mô tả UI Stitch, API và kiến trúc/native còn cần hoàn thiện.

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

Hai CNG variants: com.chande.customer và com.chande.driver, scheme và entry guards riêng; chạy đúng Metro/variant với dev build tương ứng. Combined mặc định dùng để kiểm tra hai role trong source chung. Không chỉnh android/ios generated thủ công. Native APK chưa build pass do ổ C thiếu dung lượng tải NDK; Android bundle đã pass. MapLibre/native navigation, map pin và restyle Stitch chưa triển khai xong.

Live API tests (tạo Customer test và dùng Driver fixture local, không chạy production):

```powershell
$env:APP_INTEGRATION='1'
$env:APP_BACKEND_URL='http://127.0.0.1:18080'
npm.cmd test
Remove-Item Env:APP_INTEGRATION
```

Mặc định11 unit pass /3 live skip; bật integration thì14pass trên backend local đầy đủ. Booking smoke xác nhận OSRM Hà Nội → quote → GPS/offer WebSocket → accept/replay → Trip ASSIGNED → cancel và release reservation. Đây là API/client evidence, không phải Android UI e2e.