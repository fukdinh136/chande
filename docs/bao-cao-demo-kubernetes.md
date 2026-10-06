# Rà soát dự án và demo Kubernetes

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Toàn hệ thống và Customer / Driver App |
| Rà soát | 2026-10-06 |
| Quy ước | [Format và số liệu](quy-uoc-tai-lieu.md) |

## Kết quả hiện tại

Luồng đặt xe CAR_4/CAR_7 đủ chạy demo local qua backend thật trên Kubernetes Docker Desktop. Customer và Driver đã đăng nhập được trên trình duyệt; Customer hiển thị bản đồ Hà Nội, tuyến OSRM và báo giá. Chưa nghiệm thu ứng dụng Android trên thiết bị hoặc native turn-by-turn, và chưa đủ điều kiện phát hành production.

Báo cáo này ghi lần chạy tại checkout có MapLibre/navigation mới. Số liệu trong [báo cáo frontend trước](frontend/bao-cao-ket-noi.md) và [báo cáo backend trước](bao-cao-tich-hop-backend.md) là kết quả lịch sử; không coi tổng test cũ là đã chạy lại trong lần này.

| Thành phần | Trạng thái đã xác minh | Giới hạn |
| --- | --- | --- |
| Backend | 8 API, 2 worker, PostgreSQL, Redis, RabbitMQ, OSRM và edge: 15 deployment Ready 1/1 | Cluster local một node, chưa nghiệm thu HA/production |
| Dữ liệu | Trip/Matching migration jobs Complete; 3 PVC Bound; User/Driver khởi tạo schema và fixture qua service | Chưa diễn tập backup/restore |
| Auth và Gateway | User register/login/profile thật; Driver OTP/profile; phân quyền RIDER/DRIVER; CORS đúng origin local | OTP Driver dùng mock local, chưa có SMS provider thật |
| Booking | Quote → create/replay → GPS → offer RabbitMQ/Socket.IO → accept/replay → assignment → complete/cancel → release reservation | Driver và tọa độ trong smoke là fixture tổng hợp |
| Routing/Price | OSRM graph Hà Nội thật, route 2546 m, quote 27460 VND; rich route 11 bước thật với geometry/bearing | Profile CAR; BIKE chưa nghiệm thu |
| Customer web | Đăng nhập tài khoản lưu DB, xem giá/tuyến, lịch sử và hồ sơ | Phiên chỉ nằm trong bộ nhớ, reload cần đăng nhập lại |
| Driver web | OTP, đọc OFFLINE/xe đang chọn, hồ sơ và tabs | Không bật GPS thực của máy trong lần kiểm tra UI này |
| Android/native | Source có MapLibre renderer, pin bản đồ, navigation module và cấu hình hai variant | Máy này chưa có Android SDK/APK để cài và kiểm tra thực tế |

## Demo và tài khoản

- Customer: [http://127.0.0.1:8081/customer](http://127.0.0.1:8081/customer).
- Driver: [http://127.0.0.1:8081/driver](http://127.0.0.1:8081/driver).
- Backend ingress: [http://127.0.0.1:18081](http://127.0.0.1:18081), API prefix `/api/v1`.
- Kubernetes context `docker-desktop`, namespace `chande-local`; ingress qua loopback port-forward.

Customer test được đăng ký qua API User, mật khẩu hash theo service rồi lưu thật vào PostgreSQL `user_db.users`. Query trực tiếp và đăng nhập API/giao diện đều thành công:

| Thuộc tính | Giá trị |
| --- | --- |
| Họ tên | Khách Demo Velox |
| Số điện thoại | `+84911110000` |
| Mật khẩu demo | `VeloxDemo123!` |
| User ID | `a228ac64-7ef3-4ad7-95cc-31b4b1beae28` |
| Trạng thái | `ACTIVE` |

Driver fixture có sẵn: `84900000004` (CAR_4) hoặc `84900000007` (CAR_7), OTP local `123456`. Chỉ dùng tài khoản và OTP này cho demo local. Driver được kiểm tra trên web đang OFFLINE, không có chuyến hoạt động. Dữ liệu PostgreSQL được lưu trên PVC.

[Bộ 10 ảnh Customer/Driver](../artifacts/demo-screenshots/2026-10-06/README.md) gồm bản đồ, báo giá, tài khoản, lịch sử/chi tiết chuyến, hồ sơ tài xế, phương tiện, availability và màn hình lời mời hiện chưa có offer. Giá/tọa độ trong bộ ảnh phụ thuộc các điểm được chọn tại thời điểm chụp.

## Kiểm thử trong lần chạy này

| Kiểm tra | Command / phạm vi | Kết quả |
| --- | --- | --- |
| App unit + live | `APP_INTEGRATION=1`, `APP_BACKEND_URL=http://127.0.0.1:18081`, chạy `npm.cmd test` tại `app/` | 19 pass, 0 fail, 0 skip: 15 unit và 4 live |
| App static | `npm.cmd run typecheck`, `npm.cmd run lint` | Pass |
| Routing đầy đủ | `npm.cmd run test:all` tại Routing | 47 pass, 0 fail, 0 skip |
| Routing static | `npm.cmd run typecheck`, `npm.cmd run lint` | Pass |
| Deploy topology | `node --test deploy/stack.test.cjs` | 1 pass |
| Backend smoke | `BACKEND_URL=http://127.0.0.1:18081`, `node deploy/smoke.cjs` | CAR_4 COMPLETED, CAR_7 CANCELLED; real User, REST, trip events WebSocket, offer Socket.IO, reservation released |
| Browser Customer | Login, quote, map/tuyến, history, account | Pass; giá hiển thị 27.460 ₫, quãng đường 2.5 km |
| Browser Driver | OTP login, availability, selected vehicle, profile/tabs | Pass |
| CORS | Origin `http://127.0.0.1:8081`, login preflight; origin ngoài allowlist | Local được phép; origin không tin cậy trả 403 |

Backend smoke tạo hai Trip `1ea4e2cd-43c1-4cf7-b098-27f29750a14f` và `82011fa7-3a10-436b-abb5-bbc96d304c20`. Các API test tạo dữ liệu thử riêng, kết thúc chuyến và giải phóng reservation. Rich route được xác nhận DRIVER-only; request RIDER bị từ chối. Build image thành công không thay cho việc chạy toàn bộ unit suite của tám service; lần này chỉ chạy lại suite Routing và các kiểm thử tích hợp liệt kê trên.

## Lỗi đã sửa để demo chạy được

- Customer dùng đúng `AppTabs`; Driver SessionGate bỏ prop `items` không thuộc contract component.
- Web có renderer raster OSM riêng, tránh import MapLibre Native vào SSR; hiển thị pin/tuyến thật, zoom, chọn điểm và attribution. Lỗi tile được theo dõi theo tile hiện tại.
- `BackendHttp` gọi `fetch` không gắn receiver là class instance, sửa lỗi đăng nhập web `NETWORK_ERROR`; có regression test.
- CORS Gateway đọc allowlist từ cấu hình; stack local thêm origins Expo 8081. Origin ngoài allowlist vẫn bị chặn.
- Decoder Routing/App chấp nhận geometry một điểm chỉ cho bước OSRM `arrive` có quãng đường 0; route và bước di chuyển vẫn yêu cầu tối thiểu hai điểm. Có hai regression test provider contract.
- Customer không render chuỗi lỗi rỗng trực tiếp dưới React Native View, loại cảnh báo trong web demo.

## Khởi động lại demo

Các image local, graph OSRM và cấu hình private đã được chuẩn bị. Xem [runbook backend](deploy-backend.md) nếu dựng máy mới. Từ root:

```powershell
node deploy/run.cjs kube-up
kubectl --context docker-desktop -n chande-local get deployments,jobs,pvc
```

Trong terminal riêng, chạy frontend từ `app/`:

```powershell
$env:EXPO_OFFLINE='1'
$env:APP_VARIANT='combined'
$env:EXPO_PUBLIC_LOCAL_DEMO='true'
$env:EXPO_PUBLIC_BACKEND_ORIGIN='http://127.0.0.1:18081'
$env:BROWSER='none'
node --dns-result-order=ipv4first node_modules/expo/bin/cli start --web --localhost --port 8081 --max-workers 2
```

`EXPO_OFFLINE` chỉ bỏ kiểm tra Expo bên ngoài khi start Metro; app vẫn gọi backend và tải tile bản đồ. Giữ Metro và port-forward chạy trong lúc demo. Nếu port-forward cũ đã dừng, có thể chạy riêng:

```powershell
kubectl --context docker-desktop -n chande-local port-forward --address 127.0.0.1 service/edge 18081:8088
```

## Phần còn thiếu để hoàn thiện

Ưu tiên tiếp theo là build/cài cả hai Android variant và kiểm tra GPS permission/lifecycle, MapLibre map, native navigation, trạng thái mất mạng và UI trên thiết bị. API rich route hoạt động chưa chứng minh SDK navigation chạy được trên điện thoại.

Các khoảng trống nghiệp vụ đã ghi trong [thiết kế frontend](frontend/README.md) và [hợp đồng chung](hop-dong-lien-service.md) còn gồm payment, promo, chat, rating, wallet, push/SMS thật và API live GPS tài xế cho Customer. Cần nghiệm thu bảo mật/dependency, vận hành và phục hồi dữ liệu trước production. Không gán tỷ lệ phần trăm hoàn thiện khi chưa có checklist nghiệm thu toàn bộ phạm vi này.
