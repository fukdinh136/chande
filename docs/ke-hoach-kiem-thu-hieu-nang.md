# Kế hoạch kiểm thử hiệu năng

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Toàn hệ thống |
| Rà soát | 2026-10-29 |
| Quy ước | [Format và số liệu](quy-uoc-tai-lieu.md) |

Tài liệu này là kế hoạch kiểm thử hiệu năng cho toàn bộ ứng dụng gọi xe: phạm vi, môi trường, test case theo từng loại kiểm thử, ngưỡng đạt/không đạt và quy trình tối ưu rồi đo lại. Mọi số liệu đã đo được nằm trong [báo cáo kiểm thử tải](bao-cao-kiem-thu-tai.md); công cụ nằm ở [deploy/load](../deploy/load/README.md). Mục 8 tóm tắt những gì đã chạy, mục 10 là các giả định cần xác minh trước khi chạy ở môi trường thật.

## 1. Đối chiếu yêu cầu với hệ thống hiện tại

Kế hoạch chỉ dựa trên những gì đang có trong repo. Các điểm khác với mô tả ban đầu:

| Yêu cầu nêu | Thực tế trong repo | Ảnh hưởng tới kế hoạch |
| --- | --- | --- |
| Cơ sở dữ liệu MySQL | **PostgreSQL** một instance, mỗi service một database: `user_db`, `driver_db`, `trip_db`, `matching_db` ([generate.cjs](../deploy/generate.cjs)). Java dùng HikariCP + Flyway; NestJS dùng TypeORM + `pg` | Đo bằng `pg_stat_activity`, `pg_stat_database`; đề xuất bật `pg_stat_statements`. Không có test case riêng cho MySQL |
| Customer App và Driver App | Một app Expo / React Native ([app](../app/README.md)), build theo `APP_VARIANT=customer` hoặc `driver` | Không đo hiệu năng app trên máy thật; tải được giả lập ở tầng giao thức (HTTP, Socket.IO, WebSocket) |
| Nginx | `edge` (nginx stable-alpine) là đường vào duy nhất ([nginx.conf](../deploy/nginx.conf)): `/api/v1/` và `/ws` tới Gateway, `/socket.io/` thẳng tới Realtime | Đo riêng tài nguyên và giới hạn kết nối của edge |
| API Gateway Spring Boot | Có: Spring Security, OAuth2 resource server, WebSocket `/ws`, Redis, Actuator | `/ws` là kênh sự kiện chuyến cho app khách |
| Microservice Java, NestJS | Java: Gateway, User. NestJS: Trip (API + worker), Driver, Routing, Price, Matching (API + worker), Realtime. Thêm OSRM, Redis, RabbitMQ | Mỗi service Node chạy một process, một replica |
| Socket.IO / WebSocket | Socket.IO namespace `/realtime` (Realtime) cho GPS và offer của tài xế; WebSocket thuần `/ws` (Gateway) cho sự kiện chuyến của khách | Hai kênh realtime riêng, cần hai nhóm test |
| Prometheus, Grafana | **Chưa có.** Gateway có Actuator nhưng chưa có `micrometer-registry-prometheus`; các service Node chưa có `prom-client`; chưa có exporter cho PostgreSQL, Redis, RabbitMQ, nginx | Giai đoạn 0 phải thêm. Hiện chỉ đo được từ phía client, cgroup và thống kê PostgreSQL |
| Tần suất GPS | App tài xế gửi GPS mỗi **10 giây** ([use-driver-gps.ts](../app/src/features/driver/gps/use-driver-gps.ts)) | Kịch bản thật dùng `--gps-ms 10000`; các lần đo trước dùng 3 giây (nặng gấp 3) |
| Theo dõi chuyến | App khách nhận `trip.event` qua `/ws`, rồi gọi REST để đọc lại chuyến ([trip-events.ts](../app/src/features/backend/trip-events.ts)). App không poll | Bộ k6 hiện poll mỗi 300 ms, nặng hơn thực tế; cần thêm kịch bản `/ws` (TC-RT-03) |

## 2. Thành phần và luồng nghiệp vụ cần kiểm thử

### 2.1 Thành phần

| Thành phần | Công nghệ, triển khai local | Vai trò trong luồng nóng | Rủi ro hiệu năng đã thấy |
| --- | --- | --- | --- |
| edge | nginx, 1 worker, 512 MiB (sau khi nâng) | Proxy HTTP, `/ws`, Socket.IO | Từng chỉ giữ được khoảng 500 WebSocket; từng bị OOM ở 128 MiB |
| gateway-api | Spring Boot, JVM, 1 replica | Xác thực JWT, rate limit đăng nhập, proxy, `/ws` | Rate limit đăng nhập theo IP của proxy; CPU tăng theo số request poll |
| user-api | Spring Boot, HikariCP, BCrypt | Đăng ký, đăng nhập khách | BCrypt khoảng 1,2 core ở 20 lượt đăng nhập/giây |
| driver-api | NestJS, TypeORM, Redis | OTP tài xế, availability, eligibility | Một process Node bão hòa khoảng 1 core khi nhiều tài xế lên ca cùng lúc |
| trip-api, trip-worker | NestJS, TypeORM, outbox | Báo giá, tạo chuyến, trạng thái, outbox tới Matching/Gateway | Outbox 20 tin mỗi nhịp 1 giây là trần thông lượng |
| routing-api, OSRM | NestJS + OSRM tự host | Tuyến đường, ETA matrix | Rate limit mặc định quá thấp cho OSRM tự host |
| price-api | NestJS | Tính giá | Chưa thấy rủi ro |
| matching-api, matching-worker | NestJS, TypeORM, RabbitMQ | Tìm tài xế, offer, gán | Publisher 10 tin mỗi nhịp; worker quét mỗi 1 giây |
| realtime-api | NestJS, Socket.IO, Redis GEO, RabbitMQ | GPS, tìm tài xế gần, đẩy offer | Một process; ack GPS chậm từng đợt từ khoảng 3000 tài xế |
| postgres | PostgreSQL một instance | Dữ liệu của 4 service | Chưa là nghẽn tới 8 chuyến/giây (dưới 0,9 core) |
| redis, rabbitmq | Một instance mỗi loại | Vị trí, session, hàng đợi offer | Chưa là nghẽn |

### 2.2 Luồng nghiệp vụ

| Luồng | Đường đi | Kiểu tải | Chỉ số chính |
| --- | --- | --- | --- |
| Đăng nhập khách | edge → Gateway (rate limit) → User (BCrypt, PostgreSQL) | Đột biến lúc mở app | p95, lỗi 429, CPU User |
| Đăng nhập tài xế (OTP) | edge → Gateway → Driver (OTP mock, ký JWT) | Đầu ca, kết nối lại hàng loạt | p95, lỗi 429/503, CPU Driver |
| Báo giá, tìm kiếm | Gateway → Trip → Routing (OSRM) + Price | Đều, theo số khách mở app | p95 `POST /trips/estimate` |
| Đặt chuyến | Gateway → Trip (idempotency, unique index) → outbox | Đều hoặc đột biến | p95 `POST /trips`, chuyến trùng = 0 |
| Ghép tài xế | Trip outbox → Matching worker → Routing matrix → Realtime nearby → Driver eligibility → offer qua RabbitMQ → Realtime → Socket.IO → tài xế accept → Matching → Trip | Bất đồng bộ | Thời gian `SEARCHING` → `ASSIGNED`, số chuyến gán mỗi giây |
| Cập nhật vị trí tài xế | Socket.IO `/realtime` → Realtime → Redis GEO | Liên tục, số tài xế ÷ 10 giây | Ack p95, số kết nối, CPU Realtime/Redis |
| Theo dõi chuyến | Gateway `/ws` `trip.event` → app gọi REST đọc chuyến | Theo số chuyến đang chạy | Độ trễ sự kiện, request REST sinh thêm |
| Cập nhật trạng thái chuyến | Tài xế gọi REST (đến nơi, bắt đầu, kết thúc) → Trip → outbox → Gateway `/ws` | Theo vòng đời chuyến | p95, độ trễ sự kiện tới khách |

## 3. Môi trường, công cụ và giám sát

### 3.1 Đang có

| Hạng mục | Hiện trạng |
| --- | --- |
| Tạo tải | k6 2.3 ([booking.js](../deploy/load/booking.js), [dedupe.js](../deploy/load/dedupe.js), [login.js](../deploy/load/login.js)) và bộ giả lập tài xế Node ([drivers.cjs](../deploy/load/drivers.cjs)) |
| Dữ liệu | [accounts.cjs](../deploy/load/accounts.cjs): 5000 tài xế (SQL + OTP chạy trong pod), 3000 khách; lệnh `sessions`, `tokens`, `cleanup` |
| Điều phối | [run.cjs](../deploy/load/run.cjs): chế độ tải đều, chế độ đợt `--trips`, soak `--login 1`; kết quả ở `deploy/.local/load/results/` |
| Số đo hạ tầng | [pods.cjs](../deploy/load/pods.cjs): CPU, RAM (đầu/cuối/đỉnh), network I/O từng pod; PostgreSQL commit/giây, rollback, deadlock, cache hit, kết nối theo DB và trạng thái |
| Số đo nghiệp vụ | [assignments.cjs](../deploy/load/assignments.cjs): thời gian gán và số chuyến gán mỗi phút từ `trip_db`; tách từng đoạn bằng `matching_offers` và `matching_outbox` |

### 3.2 Giới hạn của môi trường local

Docker Desktop Kubernetes một node (VM 10 CPU, 7,7 GiB), mọi tải đi qua `kubectl port-forward`. Đã gặp:
- Từ khoảng 4000 kết nối, phần CPU nằm ngoài các pod của app lên 2–5 core (kube-apiserver tới 1 core), kubelet trả lời chậm.
- Ở khoảng 3500 kết nối cộng một đợt đặt xe, `cri-dockerd` sập, node `NotReady`, phải khởi động lại Docker Desktop.

Vì vậy trên máy local: giữ dưới khoảng 2000 tài xế, mỗi lần đo không quá vài phút ở mức tải cao, và không suy ra năng lực production.

### 3.3 Môi trường đề xuất cho các giai đoạn sau (cần xác nhận)

- Cụm ít nhất 3 node, cấu hình giống production (số replica, giới hạn CPU/RAM), PostgreSQL tách riêng node.
- Máy tạo tải nằm ngoài cụm, đi qua LoadBalancer hoặc Ingress thật (không qua port-forward). Hoặc chạy k6 và bộ giả lập dưới dạng Job trong cụm, đi qua Service `edge`.
- Ít nhất 2 máy tạo tải cho 5000 kết nối trở lên, kèm đo CPU của chính máy tạo tải (bộ giả lập đã ghi `simulatorCpuCores`).

### 3.4 Giám sát đề xuất (chưa có, giai đoạn 0)

| Nguồn | Cách thêm | Chỉ số cần có |
| --- | --- | --- |
| Gateway, User (Spring Boot) | Thêm `micrometer-registry-prometheus`, mở `/actuator/prometheus` trên cổng nội bộ | `http_server_requests` theo route, HikariCP (`hikaricp_connections_active/pending`), JVM heap, GC, thread |
| Trip, Driver, Routing, Price, Matching, Realtime (NestJS) | `prom-client` + middleware HTTP; metric riêng cho outbox và worker | Thời gian request theo route, event loop lag, heap, kích thước pool `pg`, độ dài outbox, số job matching, ack Socket.IO |
| PostgreSQL | `postgres_exporter`; bật `pg_stat_statements` (`shared_preload_libraries`) | Truy vấn chậm nhất, kết nối, lock, deadlock, cache hit |
| Redis, RabbitMQ | `redis_exporter`; plugin `rabbitmq_prometheus` (cần xác minh phiên bản image) | Ops/giây, bộ nhớ; độ dài hàng đợi, publish/ack |
| nginx edge | `stub_status` + `nginx-prometheus-exporter` | Kết nối đang mở, request/giây |
| Kubernetes | metrics-server, kube-state-metrics, cAdvisor | CPU, RAM, network, restart, OOM |
| k6 | Output `experimental-prometheus-rw` | Đặt số liệu tải cạnh số liệu service trên cùng dashboard Grafana |

Dashboard Grafana tối thiểu gồm: tải đầu vào (k6), p95 theo luồng, độ dài outbox và hàng đợi, CPU/RAM theo pod, PostgreSQL, kết nối WebSocket.

## 4. Dữ liệu thử nghiệm

| Dữ liệu | Cách tạo | Ghi chú |
| --- | --- | --- |
| Tài xế | `accounts.cjs seed --drivers N`: SQL vào `driver_db` (ID tiền tố `30000000-`, biển `LOAD-`), phiên OTP lấy trong pod driver-api | Cần `GATEWAY_PROXY_TOKEN` của stack local. `sessions` tạo lại phiên khi token bị mất |
| Khách | `accounts.cjs seed --riders N` qua Gateway (số `+8498` + số thứ tự) | Stack local đặt `AUTH_MAX_ATTEMPTS=1000`/phút |
| Vị trí | Tài xế rải đều trong `--radius` quanh Hoàn Kiếm; điểm đón trong 1,5 km, điểm đến cách 1–4 km | Bán kính 6 km cho khoảng 1/9 số tài xế trong 2 km quanh trung tâm |
| Dọn dẹp | `accounts.cjs cleanup` huỷ mọi chuyến còn mở; `run.cjs` tự chạy trước mỗi lần đo | Dữ liệu test vẫn nằm trong DB local |

Môi trường dùng chung (staging) cần một cơ chế tạo tài khoản test được phép riêng thay cho SQL trực tiếp. Mục này cần xác minh.

## 5. Ngưỡng đạt/không đạt đề xuất

Đây là đề xuất để thống nhất, chưa phải SLO đã được xác nhận (mục 10).

| Chỉ số | Ngưỡng ở tải mục tiêu | Ghi chú |
| --- | --- | --- |
| Đăng nhập khách p95 | ≤ 500 ms | BCrypt chiếm phần lớn |
| Báo giá `POST /trips/estimate` p95 / p99 | ≤ 300 / 800 ms | Gồm OSRM route + price |
| Tạo chuyến `POST /trips` p95 | ≤ 300 ms | |
| `SEARCHING` → `ASSIGNED` p95 | ≤ 10 giây khi có tài xế rảnh trong 2 km | Tài xế giả lập nhận ngay; người thật sẽ lâu hơn |
| Offer: publish → tài xế nhận p95 | ≤ 500 ms | |
| Ack GPS p95 / p99 | ≤ 200 / 1000 ms | |
| Sự kiện `/ws` tới khách p95 | ≤ 1 giây sau khi trạng thái đổi | Chưa đo |
| Tỷ lệ lỗi HTTP (5xx, timeout) | < 0,5%; 4xx chỉ khi đúng nghiệp vụ | 409 khi đặt trùng là đúng |
| Chuyến trùng, tài xế bị gán hai chuyến | 0 | Kiểm bằng truy vấn DB sau mỗi lần đo |
| CPU mỗi pod ở trạng thái ổn định | ≤ 70% giới hạn | |
| RAM khi soak | Không tăng quá 10% sau khi đã ấm máy, không OOM, không restart | |
| PostgreSQL | Không deadlock; cache hit ≥ 99%; số kết nối dưới kích thước pool | |

## 6. Kế hoạch theo giai đoạn

### Giai đoạn 0: chuẩn bị

| ID | Mục tiêu | Bước thực hiện | Kết quả cần có |
| --- | --- | --- | --- |
| TC-P0-01 | Có số đo phía server | Thêm metrics và exporter ở mục 3.4, dựng Prometheus + Grafana | Dashboard tối thiểu hoạt động |
| TC-P0-02 | Thống nhất tải mục tiêu và ngưỡng | Xác nhận các mục ở mục 10 | Bảng tải mục tiêu và SLO đã duyệt |
| TC-P0-03 | Môi trường đủ lớn | Dựng cụm theo mục 3.3, kiểm tra máy tạo tải không là nghẽn | Máy tạo tải dưới 50% CPU ở tải cao nhất |

### Giai đoạn 1: Benchmark (đường cơ sở trước và sau mỗi tối ưu)

| ID | Mục tiêu | Đầu vào | Bước | Thu thập | Tiêu chí |
| --- | --- | --- | --- | --- | --- |
| TC-BM-01 | Đường cơ sở luồng đặt xe | 50 tài xế, 1 chuyến/giây, 5 phút | `run.cjs --drivers 50 --rate 1 --duration 5m` | p50/p95/p99 từng bước, thời gian gán, CPU/RAM | Lưu làm mốc; mọi tối ưu đo lại đúng kịch bản này |
| TC-BM-02 | Đường cơ sở đăng nhập | 5→20 lượt/giây, mỗi mức 1 phút | `k6 run login.js` | p95, 429, CPU User | Như trên |
| TC-BM-03 | Đường cơ sở GPS | 1000 tài xế, GPS 10 giây | `drivers.cjs --count 1000 --gps-ms 10000` | Ack p50/p95, CPU Realtime/Redis | Như trên |

### Giai đoạn 2: Load test (tải dự kiến)

| ID | Mục tiêu | Đầu vào | Bước | Thu thập | Tiêu chí |
| --- | --- | --- | --- | --- | --- |
| TC-LD-01 | Đặt xe ở tải dự kiến | Số tài xế online và chuyến/giây giờ cao điểm (mục 10) | `run.cjs --drivers N --rate R --duration 15m --gps-ms 10000` | Như TC-BM-01 cộng PostgreSQL | Đạt mọi ngưỡng ở mục 5 |
| TC-LD-02 | GPS ở số tài xế dự kiến | N tài xế, GPS 10 giây, 15 phút | `drivers.cjs` | Ack p95/p99, mất kết nối, CPU | Ack p95 ≤ 200 ms, không mất kết nối |
| TC-LD-03 | Đăng nhập lúc mở app | Lượt/giây dự kiến | `login.js` với `STAGES=R` | p95, 429 | p95 ≤ 500 ms, không 429 với người dùng hợp lệ |

### Giai đoạn 3: Stress test (tìm giới hạn)

| ID | Mục tiêu | Đầu vào | Bước | Thu thập | Tiêu chí |
| --- | --- | --- | --- | --- | --- |
| TC-ST-01 | Trần thông lượng đặt xe | 1000 tài xế, tăng 2 → 4 → 8 → 16 chuyến/giây, mỗi mức 2 phút | `run.cjs --rate R --duration 2m` | Thời gian gán, độ dài outbox, CPU | Ghi lại mức đầu tiên mà thời gian gán tăng dần theo thời gian |
| TC-ST-02 | Trần kết nối tài xế | 500 → 1000 → 2000 → 5000 tài xế, lên mạng 25/giây | `drivers.cjs --ramp 25` | Kết nối, ack, CPU/RAM edge và Realtime, OOM | Ghi lại thành phần gãy đầu tiên |
| TC-ST-03 | Trần đăng nhập | Tăng tới khi p95 > 1 giây hoặc lỗi > 1% | `login.js` | p95, CPU User, pool Hikari | Như trên |

### Giai đoạn 4: Spike test (tăng đột biến)

| ID | Mục tiêu | Đầu vào | Bước | Thu thập | Tiêu chí |
| --- | --- | --- | --- | --- | --- |
| TC-SP-01 | Đợt đặt xe | 3500 tài xế; 3000 khách đặt trong 2 phút và giữ chuyến | `run.cjs --trips 3000 --rate 25 --drain 1200` | Thời gian gán theo phút, chuyến chưa gán, lỗi | Theo SLO đã thống nhất; ghi lại thời gian gán hết |
| TC-SP-02 | Tài xế kết nối lại đồng loạt | N tài xế online, restart edge hoặc Realtime | Restart pod trong lúc chạy `drivers.cjs` | Thời gian kết nối lại hết, lỗi 503 ở Driver, restart | Kết nối lại hết trong 60 giây, không có service bị restart theo |
| TC-SP-03 | Đăng nhập đột biến | 0 → 50 lượt/giây trong 10 giây | `login.js` với `STAGES=50` | p95, 429, CPU | Không 5xx; 429 chỉ theo thiết kế |

### Giai đoạn 5: Endurance / soak

| ID | Mục tiêu | Đầu vào | Bước | Thu thập | Tiêu chí |
| --- | --- | --- | --- | --- | --- |
| TC-SK-01 | Rò rỉ bộ nhớ, suy giảm theo thời gian | 1000 tài xế, GPS 10 giây, 2 chuyến/giây, 30 phút (local) rồi 4–8 giờ (staging) | `run.cjs --duration 30m --interval 30 --login 1` | RAM đầu/cuối từng pod, p95 theo thời gian, kết nối DB, restart | RAM ổn định sau khi ấm máy; p95 cuối kỳ không quá 1,2 lần đầu kỳ |
| TC-SK-02 | Bảng tăng dần theo thời gian | Như trên | Đếm số dòng `trip_status_history`, `outbox_deliveries`, `matching_outbox` trước và sau | Tốc độ tăng, thời gian truy vấn | Có kế hoạch dọn bảng outbox đã gửi |

### Giai đoạn 6: Đồng thời và nhất quán dữ liệu

| ID | Mục tiêu | Đầu vào | Bước | Thu thập | Tiêu chí |
| --- | --- | --- | --- | --- | --- |
| TC-CC-01 | Không tạo chuyến trùng | 30 khách, mỗi khách 10 request tạo chuyến đồng thời; 3 trường hợp: cùng quote + cùng key, cùng quote + khác key, khác quote + khác key | `k6 run dedupe.js`, sau đó truy vấn `trips` | Số chuyến tạo ra, mã trạng thái, quote dùng hai lần, khách có hai chuyến mở | Mỗi khách tối đa 1 chuyến mỗi trường hợp; 0 vi phạm |
| TC-CC-02 | Một tài xế không bị giữ cho hai chuyến | Nhiều chuyến cùng lúc quanh ít tài xế | `run.cjs` với `--drivers 20 --rate 4`, sau đó truy vấn `matching_reservations` và `uq_trips_active_driver` | Số tài xế có hai chuyến mở | 0 |
| TC-CC-03 | Accept trùng | Tài xế gửi accept 2 lần cùng lúc với key khác nhau; hai tài xế accept hai offer của cùng một chuyến | Script riêng (chưa có) | Mã trạng thái, số lần gán | Chuyến gán đúng 1 lần |
| TC-CC-04 | Nhiều tài xế cập nhật vị trí cùng lúc | N tài xế gửi GPS cùng một mili giây (bỏ giãn cách) | `drivers.cjs` với giãn cách 0 (chưa có tùy chọn) | Ack p99, bản tin bị từ chối | Không mất bản tin hợp lệ |
| TC-CC-05 | Quá tải lan giữa các service | Đặt xe vượt trần (TC-ST-01) | Quan sát timeout, retry, restart | Lỗi `ROUTING_BUSY`, `DEPENDENCY_UNAVAILABLE`, retry matching | Lỗi được giới hạn, không có service bị restart theo |

### Giai đoạn 7: Realtime và WebSocket

| ID | Mục tiêu | Đầu vào | Bước | Thu thập | Tiêu chí |
| --- | --- | --- | --- | --- | --- |
| TC-RT-01 | Độ trễ GPS | Như TC-LD-02 | `drivers.cjs` | Ack p50/p95/p99 | Mục 5 |
| TC-RT-02 | Độ trễ offer tới tài xế | Như TC-LD-01 | Tách đoạn publish → accept từ DB | p95 | ≤ 500 ms |
| TC-RT-03 | Sự kiện chuyến tới khách qua `/ws` | Mỗi khách k6 mở `/ws`, gửi `auth`, ghi thời điểm nhận `trip.event` | Script k6 WebSocket (chưa có) thay cho poll | Độ trễ sự kiện, số kết nối `/ws`, CPU Gateway | ≤ 1 giây; dùng thay poll trong mọi kịch bản sau |

### Giai đoạn 8: Scalability

| ID | Mục tiêu | Đầu vào | Bước | Thu thập | Tiêu chí |
| --- | --- | --- | --- | --- | --- |
| TC-SC-01 | Thông lượng theo số replica | Matching worker, Trip worker 1 → 2 → 4 replica; cùng kịch bản TC-ST-01 | Đổi số replica, đo lại | Chuyến gán/giây | Tăng gần tuyến tính; nếu không, tìm nghẽn chung (PostgreSQL, khoá) |
| TC-SC-02 | Realtime nhiều replica | 2 replica Realtime, tài xế phân bổ đều | Đo GPS và offer | Offer có tới đúng tài xế không | Cần xác minh thiết kế trước (mục 10) |
| TC-SC-03 | Gateway nhiều replica với `/ws` | 2 replica Gateway | Sự kiện có tới khách ở replica khác không | Tỷ lệ sự kiện tới nơi | 100% |

### Giai đoạn 9: Tối ưu và đo lại

Với mỗi tối ưu trong [đề xuất cải tiến hiệu năng](de-xuat-cai-tien-hieu-nang.md): chạy lại đúng kịch bản benchmark liên quan (TC-BM-xx) và kịch bản stress (TC-ST-01), so trước/sau trong một bảng, ghi vào báo cáo kiểm thử tải. Một lần đo chỉ đổi một thay đổi.

## 7. Thu thập và phân tích kết quả

- Mỗi lần chạy `run.cjs` ghi `summary.json` (k6, tài xế, pod, PostgreSQL, thời gian gán) vào `deploy/.local/load/results/<thời điểm>/`.
- Với luồng ghép tài xế, luôn tách thời gian theo đoạn (outbox Trip, worker, publish, accept, gán) bằng `trip_status_history`, `matching_offers`, `matching_outbox`. Cách này đã chỉ ra đúng nghẽn ở outbox, trong khi chỉ nhìn CPU thì không thấy.
- Sau mỗi lần đo: truy vấn kiểm nhất quán (chuyến trùng, tài xế hai chuyến, chuyến kẹt ở `SEARCHING`) và chạy `accounts.cjs cleanup`.

## 8. Những gì đã chạy (local)

Lần đo sau nhóm cải tiến A và E1–E3 (2026-11-04), chi tiết trong [báo cáo kiểm thử tải](bao-cao-kiem-thu-tai.md):

| Loại | Kịch bản | Kết quả chính | Chi tiết |
| --- | --- | --- | --- |
| Stress, so với mốc ban đầu | 1000 tài xế, 2 → 10 chuyến/giây, cách đo cũ | Cao nhất còn đạt ngưỡng: 6 chuyến/giây, p95 1,0 giây (mốc ban đầu: 2 chuyến/giây, p95 4,0 giây) | [Mục 6.1](bao-cao-kiem-thu-tai.md#61-so-với-mốc-ban-đầu) |
| Stress, thông lượng | 1000 tài xế, 2 → 16 chuyến/giây, giống app | Đạt ngưỡng tới 6 chuyến/giây; gán tối đa khoảng 10,5 chuyến/giây; từ 8 chuyến/giây driver-api chạm 1 core | [Mục 6.2](bao-cao-kiem-thu-tai.md#62-thông-lượng-tối-đa), [mục 7.1](bao-cao-kiem-thu-tai.md#71-driver-api-kiểm-tra-từng-tài-xế-một) |
| Load, kết nối | 1000 → 5000 tài xế, 4 chuyến/giây | Đạt ngưỡng tới 5000 tài xế, p95 1,3 giây, 0 lỗi kết nối | [Mục 6.4](bao-cao-kiem-thu-tai.md#64-tăng-quy-mô-số-tài-xế) |
| Soak | 1000 tài xế, 3 chuyến/giây, 30 phút | 5388/5395 chuyến; RAM ổn định; một đợt chậm 3 phút chưa rõ nguyên nhân | [Mục 6.5](bao-cao-kiem-thu-tai.md#65-chạy-lâu-30-phút) |
| Đăng nhập | 5 → 15 lượt/giây; rate limit theo IP thật (A4) | p95 77 ms, 0 lỗi; IP giả bị bỏ qua, mỗi IP một quota | [Mục 6.6](bao-cao-kiem-thu-tai.md#66-đăng-nhập-và-rate-limit-theo-ip) |

Mốc ban đầu (2026-10-28/29, báo cáo ở commit `bc1db9b`):

| Loại | Kịch bản | Kết quả chính | Chi tiết |
| --- | --- | --- | --- |
| Benchmark | 50 tài xế, 1 chuyến/giây | Trước: 1/270 chuyến được gán. Sau nâng giới hạn Routing: 301/301, p95 7,4 giây. Sau nâng worker: p95 4,0 giây | Báo cáo `bc1db9b`, lần 1–4 |
| Load | 2 chuyến/giây với 500, 1000, 2000 tài xế | Mọi chuyến được gán, p95 3,7–4,0 giây, không lỗi | Báo cáo `bc1db9b` |
| Stress, thông lượng | 1000 tài xế, 4, 8, 12 chuyến/giây | Trần khoảng 2,5–3 chuyến/giây do hai outbox. Ở 8 chuyến/giây: chỉ 110/706 chuyến được gán trong 60 giây, báo giá p95 7,3 giây | Báo cáo `bc1db9b` |
| Stress, kịch bản cao nhất | 1000 và 2000 tài xế, 2 → 2,5 → 3 chuyến/giây | Cao nhất còn đạt ngưỡng: khoảng 1000 tài xế, 2 chuyến/giây (khoảng 7200 chuyến/giờ). 2,5 chuyến/giây hoặc 2000 tài xế là vượt ngưỡng | Báo cáo `bc1db9b` |
| Stress, kết nối | 500 → 5000 tài xế | Gãy lần lượt ở edge `worker_connections`, edge OOM, driver-api, rồi môi trường đo | Báo cáo `bc1db9b` |
| Spike | 3500 tài xế + 3000 chuyến trong 2 phút | Không chạy trọn: `cri-dockerd` sập. Ước tính cần 13–17 phút để gán hết | Báo cáo `bc1db9b` |
| Nhất quán | TC-CC-01, 30 khách × 10 request × 3 trường hợp | **0 chuyến trùng**; 59 chuyến cho 30 khách; 0 quote dùng hai lần; 0 khách có hai chuyến mở | Chỉ ghi trong kế hoạch này |
| Đăng nhập | TC-BM-02, 5 → 20 lượt/giây | p95 79 ms; User 0,68 core trung bình, 1,2 core đỉnh; 201 lượt (6,25%) bị 429 ở mức 20/giây | Chỉ ghi trong kế hoạch này |
| Soak | TC-SK-01, 1000 tài xế, GPS 10 giây, 2 chuyến/giây; dùng 20 phút hợp lệ của lần 3 | 2336/2336 chuyến được gán, p95 5,0 giây, không tăng dần; 0% lỗi HTTP, 0 deadlock, 0 restart; RAM gần như phẳng. Hai lần đầu hỏng vì lỗi của bộ giả lập (đã sửa) | Chỉ ghi trong kế hoạch này |

## 9. Bottleneck và phương án tối ưu

Toàn bộ phương án tối ưu, kèm công sức, chi phí, đối chiếu ADR và lộ trình, nằm trong [đề xuất cải tiến hiệu năng](de-xuat-cai-tien-hieu-nang.md). Mỗi phương án ở đó ghi kịch bản dùng để đo lại.

## 10. Giả định và việc cần xác minh trước khi chạy ở môi trường thật

1. **Cơ sở dữ liệu:** repo dùng PostgreSQL. Nếu production dùng MySQL thì cần chỉ ra service và cấu hình tương ứng, vì hiện không có.
2. **Tải mục tiêu:** số khách và tài xế online giờ cao điểm, số chuyến/phút, mức đột biến lớn nhất (ví dụ 3000 khách trong 2 phút). Đây là đầu vào cho TC-LD và TC-SP.
3. **SLO:** xác nhận hoặc chỉnh các ngưỡng ở mục 5.
4. **Hạ tầng production:** số node, số replica từng service, giới hạn CPU/RAM, có HPA không, cấu hình PostgreSQL (tách riêng, replica đọc).
5. **Realtime nhiều replica:** offer từ RabbitMQ có tới đúng replica đang giữ socket của tài xế không. Gateway `/ws` nhiều replica có phát sự kiện qua Redis không. Chưa xác minh trong code.
6. **Giám sát:** có được thêm Prometheus/Grafana và exporter vào cụm thử nghiệm không, và ai vận hành.
7. **Dữ liệu test ở staging:** cách tạo tài khoản tài xế (hiện chèn bằng SQL) và OTP mock có được bật ở staging không.
8. **OSRM:** production dùng dataset và cấu hình nào; năng lực bảng (`table`) thật để đặt rate limit Routing.
9. **Hành vi người thật:** thời gian tài xế cân nhắc offer, tỷ lệ từ chối, tỷ lệ khách huỷ. Bộ đo hiện coi tài xế nhận ngay và khách không huỷ.
