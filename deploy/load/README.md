# Kiểm thử tải local

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Toàn hệ thống |
| Rà soát | 2026-10-29 |
| Quy ước | [Format và số liệu](../../docs/quy-uoc-tai-lieu.md) |

Bộ công cụ đo baseline cho mục P2.6 trong [kiến trúc mục tiêu](../../docs/kien-truc-muc-tieu.md). Chỉ chạy với stack Kubernetes local qua `http://127.0.0.1:18081`; script từ chối địa chỉ không phải loopback. Kết quả lần chạy gần nhất ghi trong [báo cáo kiểm thử tải](../../docs/bao-cao-kiem-thu-tai.md).

## Thành phần

| File | Vai trò |
| --- | --- |
| `accounts.cjs` | `seed`: chèn tài xế test bằng SQL vào `driver_db` (Driver không có API đăng ký), lấy phiên OTP ngay trong pod driver-api, đăng ký rider qua User API. `tokens`: refresh token rider cho k6 |
| `drivers.cjs` | Giả lập tài xế: ONLINE, chọn xe, gửi GPS qua Socket.IO `/realtime`, tự nhận mọi offer; đo ack GPS và thời gian gọi accept |
| `booking.js` | k6, executor `constant-arrival-rate`: báo giá → tạo chuyến → poll tới `ASSIGNED` → huỷ để trả tài xế |
| `pods.cjs` | Lấy mẫu CPU/RAM từng pod từ cgroup bằng `kubectl exec` (Docker Desktop không có metrics-server) |
| `run.cjs` | Chạy một lần đo đầy đủ, ghi kết quả vào `deploy/.local/load/results/<thời điểm>/` |
| `assignments.cjs` | Đọc `trip_db`: số chuyến bắt đầu SEARCHING sau `--since`, số đã gán, thời gian chờ và số chuyến gán mỗi phút; `--wait N` chờ tới khi hết chuyến SEARCHING |
| `segments.cjs` | Tách `SEARCHING` → `ASSIGNED` theo đoạn (tạo offer, publish, accept, Trip ghi `ASSIGNED`) từ mốc thời gian trong `trip_db` và `matching_db`, cho chuyến bắt đầu trong khoảng `--since` … `--until`. Lấy hai mốc này từ `started`, `finished` trong `summary.json` |

Dữ liệu test nằm trong `deploy/.local/load/` (đã gitignore): `drivers.json`, `riders.json` chứa refresh token, `rider-tokens.json` chứa access token cho k6. Tài xế test có ID tiền tố `30000000-`, số điện thoại `8496xxxxxxx`, biển số `LOAD-xxxxxx`, xe `CAR_4`. Rider có tên `Load Rider N`.

## Chạy

Cần stack đang chạy (`node deploy/run.cjs kube-up`), port-forward `18081`, Node 20+ và k6 (`brew install k6`). Từ root:

```bash
node deploy/load/accounts.cjs seed --drivers 50 --riders 40
node deploy/load/run.cjs --drivers 50 --rate 1 --duration 5m
```

`seed` có thể chạy lại và tiếp tục từ chỗ dừng. OTP mock của Driver chỉ cho 10 lần/phút cho mỗi IP, và qua Gateway mọi client chung một IP. Vì vậy phiên tài xế được lấy bằng một script chạy trong pod driver-api: script gọi thẳng `localhost` với header proxy tin cậy (`GATEWAY_PROXY_TOKEN` của stack local) và một IP giả riêng cho mỗi tài xế (dải `198.18.0.0/15`). 5000 tài xế mất khoảng 10 giây. Rider vẫn đi qua Gateway; stack local đặt `AUTH_MAX_ATTEMPTS=1000` lần/phút cho mỗi endpoint (mặc định của Gateway là 5), nên 3000 rider mất vài phút.

Refresh token xoay vòng sau mỗi lần dùng. Nếu một lần chạy bị dừng đột ngột, một số token trong `drivers.json` có thể đã hết hiệu lực, và bộ giả lập sẽ phải đăng nhập OTP lại qua Gateway, rất chậm. Khi đó, đổi tên `drivers.json` rồi chạy lại `seed` để lấy phiên mới.

| Tham số `run.cjs` | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `--drivers` | 50 | Số tài xế giả lập, không vượt số đã seed |
| `--radius` | 2000 | Bán kính (m) quanh Hoàn Kiếm để rải tài xế |
| `--ramp` | 0 | Số tài xế lên mạng mỗi giây; 0 là nhanh nhất có thể (10 tài xế song song) |
| `--rate` | 1 | Số chuyến mới mỗi giây |
| `--duration` | 5m | Thời gian bơm tải của k6 |
| `--warmup` | 20 | Số giây chờ sau khi tài xế ONLINE trước khi đặt xe |
| `--interval` | 10 | Chu kỳ lấy mẫu CPU/RAM, giây |
| `--trips` | 0 | Khác 0 là chế độ đợt đặt xe: N rider mỗi người đặt một chuyến (báo giá, tạo chuyến) và giữ chuyến; thời gian gán đo từ DB |
| `--drain` | 900 | Chế độ đợt: số giây tối đa chờ mọi chuyến được gán trước khi huỷ hết |

Số rider giới hạn số chuyến đang chờ cùng lúc: mỗi VU k6 dùng một rider. Với `--rate 1` và thời gian tới `ASSIGNED` khoảng vài giây, 40 rider là đủ. Tăng rate thì seed thêm rider.

Trước mỗi lần đo, `run.cjs` tạo phiên mới cho các tài xế sẽ dùng (`accounts.cjs sessions`) và huỷ mọi chuyến còn mở của rider (`accounts.cjs cleanup`). Ví dụ chế độ đợt:

```bash
node deploy/load/accounts.cjs seed --drivers 3500 --riders 3000
node deploy/load/run.cjs --drivers 3500 --radius 6000 --ramp 25 --trips 3000 --rate 25 --drain 1200
```

Trên Docker Desktop, mọi kết nối đi qua `kubectl port-forward` và `cri-dockerd`. Ở khoảng 3500 kết nối tài xế, `cri-dockerd` đã sập và node chuyển `NotReady` (phải khởi động lại Docker Desktop). Trên máy một node, nên giữ dưới khoảng 2000 tài xế, hoặc chạy bộ giả lập trong cụm.

## Cách đọc số liệu

- `time_to_assigned`: từ lúc `POST /trips` trả 201 tới lần poll đầu tiên thấy `ASSIGNED`; sai số tối đa bằng `POLL_MS` (300 ms). Gồm outbox Trip, Matching tìm ứng viên, offer qua RabbitMQ và Socket.IO, tài xế giả lập gọi accept.
- `quote`, `create`, `poll`, `cancel`: thời gian HTTP từng bước đo từ máy chạy k6 qua port-forward và edge nginx.
- `gpsAckMs`: thời gian Realtime ack một bản tin `driver.location.update`.
- CPU tính bằng millicore (1000 = một core). Lấy mẫu bằng `kubectl exec` nên tự nó cũng thêm một chút tải.

Giống app, bộ giả lập gửi token hiện tại mỗi lần kết nối Socket.IO, và tự kết nối lại sau 1–5 giây khi Realtime ngắt socket lúc JWT hết hạn (`io server disconnect`). Token REST được làm mới mỗi 10 phút. Bộ giả lập bỏ qua tài xế không lên mạng được và ghi vào `onlineFailures`; chỉ dừng khi quá 5% tài xế lỗi. `simulatorCpuCores` là CPU trung bình của chính bộ giả lập.

Tài xế giả lập nhận offer ngay lập tức, nên số đo không gồm thời gian người thật cân nhắc. Poll trạng thái chuyến tạo thêm khoảng 3 request/giây cho mỗi chuyến đang chờ.
