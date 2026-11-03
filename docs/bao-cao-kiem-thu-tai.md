# Báo cáo kiểm thử tải

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Toàn hệ thống |
| Rà soát | 2026-10-29 |
| Quy ước | [Format và số liệu](quy-uoc-tai-lieu.md) |

Kết quả ba nhóm kiểm thử hiệu năng cho mục P2.6 trong [kiến trúc mục tiêu](kien-truc-muc-tieu.md). Kế hoạch, test case và ngưỡng đạt/không đạt nằm trong [kế hoạch kiểm thử hiệu năng](ke-hoach-kiem-thu-hieu-nang.md); công cụ và cách chạy nằm trong [deploy/load](../deploy/load/README.md). Ba nhóm gồm: benchmark luồng đặt xe trước và sau tối ưu, tăng quy mô số tài xế, và trần thông lượng cùng kịch bản 3000 khách. Mọi lần đo chạy trên stack Kubernetes local, mục tiêu là tìm điểm nghẽn và so trước/sau, không phải nghiệm thu năng lực production.

## Kết luận

| Câu hỏi | Trả lời ngắn | Mục |
| --- | --- | --- |
| Luồng đặt xe có chạy ở tải thấp không? | Ban đầu không: chỉ 1/270 chuyến tìm được tài xế vì rate limit của Routing. Sau khi chỉnh cấu hình: 100% chuyến được gán, p95 4,0 giây ở 1–2 chuyến/giây | [Benchmark](#benchmark-luồng-đặt-xe) |
| Hệ thống gán được bao nhiêu chuyến mỗi giây? | Khoảng **2,5–3 chuyến/giây** là trần. Trần nằm ở hai hàng đợi outbox (Trip, Matching), không phải ở CPU hay ở bước tìm tài xế | [Trần thông lượng](#trần-thông-lượng-đặt-xe), [điểm nghẽn 1](#1-hai-hàng-đợi-outbox-giới-hạn-khoảng-3-chuyếngiây) |
| Kịch bản cao nhất còn đạt ngưỡng? | **Khoảng 1000 tài xế online, 2 chuyến/giây** (khoảng 7200 chuyến/giờ): p95 tới `ASSIGNED` 4,0 giây, 0% lỗi. Từ 2,5 chuyến/giây, hoặc 2000 tài xế, là bắt đầu vượt ngưỡng | [Kịch bản cao nhất](#kịch-bản-cao-nhất-đạt-được) |
| 3000 khách cùng đặt khi có 3500 tài xế rảnh thì sao? | **Chưa đáp ứng được.** Tài xế đủ, nhưng cần khoảng 13–20 phút để gán hết 3000 chuyến. Đặt trong 1–2 phút thì phần lớn khách phải chờ quá 1 phút | [Kịch bản 3000 khách](#kịch-bản-3000-khách-và-3500-tài-xế) |
| Chịu được bao nhiêu tài xế online? | 500, 1000, 2000 tài xế ổn ở 2 chuyến/giây. Khi lên 5000, gãy lần lượt ở edge nginx, driver-api, rồi chính môi trường đo | [Tăng quy mô](#tăng-quy-mô-số-tài-xế) |

Việc cần làm trước tiên là sửa hai hàng đợi outbox ([điểm nghẽn 1](#1-hai-hàng-đợi-outbox-giới-hạn-khoảng-3-chuyếngiây)), rồi rate limit đăng nhập theo IP của proxy ([điểm nghẽn 2](#2-rate-limit-đăng-nhập-tính-theo-ip-của-proxy)).

## Môi trường

| Thuộc tính | Giá trị |
| --- | --- |
| Mã nguồn | commit `5d36b2e` cộng `deploy/load/` và các thay đổi cấu hình local bên dưới, chưa commit |
| Hạ tầng | Docker Desktop Kubernetes một node, VM 10 CPU / 7,7 GiB; mỗi deployment 1 replica, request 50m CPU, limit 2 CPU |
| Đường vào | k6 và bộ giả lập tài xế chạy trên máy host → `kubectl port-forward` cổng `18081` → edge nginx → Gateway (HTTP, `/ws`) hoặc Realtime (Socket.IO) |
| Tài xế giả lập | `CAR_4`, rải đều trong bán kính 2 km hoặc 6 km quanh Hoàn Kiếm (21.0285, 105.8542), GPS mỗi 3 giây (app thật gửi mỗi 10 giây), nhận mọi offer ngay |
| Khách giả lập | Điểm đón trong 1,5 km quanh tâm, điểm đến cách 1–4 km. Mỗi chuyến: báo giá → tạo chuyến → poll `GET /trips/:id` mỗi 300 ms tới `ASSIGNED` (tối đa 60 giây) → huỷ để trả tài xế. Chế độ đợt (`--trips`, kịch bản 3000 khách) thì giữ chuyến, không poll |
| Số đo | k6 phía client; cgroup CPU/RAM, network I/O từng pod; `pg_stat_activity`, `pg_stat_database`; mốc thời gian trong `trip_status_history`, `matching_offers`, `matching_outbox`. Chưa có metrics phía service |

Các thay đổi cấu hình trên stack local trong quá trình đo. Code service và giá trị mặc định trong code không đổi.

| Thay đổi | File | Lý do |
| --- | --- | --- |
| Routing `RATE_LIMIT_REQUESTS_PER_SECOND=50`, `RATE_LIMIT_BURST=20`, `RATE_LIMIT_MATRIX_ELEMENTS_PER_MINUTE=20000` | [stack.cjs](../deploy/stack.cjs) | Mặc định chặn gần hết lời gọi matrix ([điểm nghẽn 6](#6-rate-limit-routing-mặc-định-đã-chỉnh-trên-local)) |
| matching-worker `WORKER_CONCURRENCY=8` | [stack.cjs](../deploy/stack.cjs) | Mặc định 2 job mỗi nhịp gây xếp hàng ở 1 chuyến/giây ([điểm nghẽn 7](#7-nhịp-poll-1-giây-của-worker-matching-đã-giảm-trên-local)) |
| Edge `worker_connections 16384`, `worker_rlimit_nofile 65536`, RAM 512 MiB | [nginx.conf](../deploy/nginx.conf), [generate.cjs](../deploy/generate.cjs) | Edge gãy ở khoảng 500 WebSocket và bị OOM ở 128 MiB ([điểm nghẽn 4](#4-edge-nginx-chưa-cấu-hình-cho-websocket-số-lượng-lớn)) |
| Driver `GATEWAY_PROXY_TOKEN` | [stack.cjs](../deploy/stack.cjs) | Cho bước seed tài xế lấy OTP với IP giả riêng từng tài xế. Gateway vẫn chưa gửi header này |
| Gateway `AUTH_MAX_ATTEMPTS` 30 → 1000 lần/phút | [stack.cjs](../deploy/stack.cjs) | Seed 3000 khách cho kịch bản 3000 khách |
| `generate.cjs` tự bổ sung secret còn thiếu, giữ nguyên secret đã có | [generate.cjs](../deploy/generate.cjs) | Thêm secret `driverProxy` mà không đổi các secret khác |

## Benchmark luồng đặt xe

50 tài xế trong 2 km, GPS mỗi 3 giây, mỗi lần 5 phút. Mỗi lần chỉ đổi một cấu hình so với lần trước.

```bash
node deploy/load/accounts.cjs seed --drivers 50 --riders 80
node deploy/load/run.cjs --drivers 50 --rate 1 --duration 5m
```

| Chỉ số | Lần 1: mặc định | Lần 2: nâng Routing | Lần 3: thêm worker 8 | Lần 4: gấp đôi tải |
| --- | --- | --- | --- | --- |
| Thời điểm (UTC) | 10-28 16:04 | 10-28 18:10 | 10-29 03:02 | 10-29 03:08 |
| Tải | 1 chuyến/giây | 1 chuyến/giây | 1 chuyến/giây | 2 chuyến/giây |
| Tìm được tài xế trong 60 giây | 1/270 (0,4%) | 301/301 | 301/301 | 600/600 |
| Tạo chuyến → `ASSIGNED` p50 / p95 / max | chuyến duy nhất 48,9 giây | 7319 / 7351 / 8278 ms | 3064 / 3965 / 4355 ms | 3347 / 3962 / 4127 ms |
| Request HTTP / lỗi | 57691 / 0% | 8104 / 0% | 4064 / 0% | 8223 / 0% |
| Offer tới tài xế / accept thành công | 2 / 2 | 332 / 332 | 301 / 301 | 600 / 600 |
| GPS gửi / được ack | 5899 / 5899 | 5491 / 5491 | 5457 / 5457 | 5448 / 5448 |
| `matching_job_retry` | 658 (8 phút) | 4 | 0 | 0 |

Ở lần 1, 30 chuyến cuối bị k6 dừng khi hết thời gian. Ở lần 2, DB có đúng 1 offer cho mỗi chuyến nhưng tài xế nhận 332 sự kiện `driver.trip.offer` (31 sự kiện lặp). Từ lần 3, khi worker không còn xếp hàng, số sự kiện khớp đúng số chuyến; nguyên nhân sự kiện lặp chưa được xác minh.

Độ trễ từng bước (p50 / p95 / max, ms):

| Bước | Lần 1 | Lần 2 | Lần 3 | Lần 4 |
| --- | --- | --- | --- | --- |
| Báo giá `POST /trips/estimate` | 12 / 93 / 234 | 10 / 23 / 48 | 15 / 53 / 118 | 8 / 20 / 64 |
| Tạo chuyến `POST /trips` | 5 / 24 / 156 | 5 / 13 / 23 | 6 / 29 / 154 | 5 / 14 / 102 |
| Đọc chuyến `GET /trips/:id` | 6 / 28 / 281 | 3 / 7 / 45 | 4 / 9 / 77 | 3 / 7 / 134 |
| Huỷ `POST /trips/:id/cancel` | 6 / 22 / 151 | 4 / 8 / 25 | 5 / 15 / 66 | 4 / 8 / 45 |
| Ack GPS `driver.location.update` | 2 / 7 / 130 | 2 / 4 / 39 | 2 / 5 / 63 | 2 / 4 / 115 |
| Tài xế gọi accept | 24 / 30 / 30 | 6 / 14 / 23 | 7 / 23 / 86 | 7 / 12 / 39 |

CPU trung bình / cao nhất (millicore), lấy mẫu mỗi 10 giây:

| Pod | Lần 1 | Lần 2 | Lần 3 | Lần 4 | RAM cao nhất lần 4 |
| --- | --- | --- | --- | --- | --- |
| gateway-api | 223 / 328 | 48 / 73 | 40 / 61 | 54 / 71 | 473 MiB |
| trip-api | 138 / 194 | 41 / 47 | 33 / 44 | 49 / 59 | 101 MiB |
| postgres | 95 / 145 | 45 / 52 | 50 / 71 | 79 / 94 | 327 MiB |
| driver-api | 32 / 49 | 19 / 31 | 23 / 35 | 32 / 56 | 83 MiB |
| realtime-api | 18 / 27 | 16 / 24 | 19 / 30 | 22 / 31 | 188 MiB |
| matching-worker | ≤ 12 / ≤ 28 | 12 / 16 | 21 / 42 | 21 / 27 | 76 MiB |
| matching-api | ≤ 12 / ≤ 28 | 10 / 15 | 11 / 22 | 14 / 21 | 90 MiB |
| routing-api | ≤ 12 / ≤ 28 | 8 / 12 | 9 / 17 | 12 / 22 | 84 MiB |

Các pod còn lại đều dưới 30m. Ở lần 1, tải của Gateway, Trip và PostgreSQL chủ yếu đến từ việc 269 chuyến phải poll đủ 60 giây; từ lần 2, mỗi chuyến chỉ poll vài giây nên tải giảm 3–5 lần.

Thời gian tới `ASSIGNED` tách theo đoạn, từ mốc thời gian trong DB (p50 / p95 / max, ms):

| Đoạn | Lần 2 (worker 2, 1 chuyến/giây) | Lần 4 (worker 8, 2 chuyến/giây) |
| --- | --- | --- |
| `SEARCHING` → Matching tạo offer | 3074 / 3241 / 4960 | 1177 / 1777 / 1905 |
| Offer vào outbox → publish lên RabbitMQ | 979 / 991 / 1035 | 966 / 981 / 1009 |
| Publish → tài xế accept (Realtime, Socket.IO, HTTP) | 5 / 12 / 26 | 6 / 11 / 21 |
| Accept → Trip `ASSIGNED` | 3004 / 3027 / 3077 | 1006 / 1019 / 1046 |
| Tổng `SEARCHING` → `ASSIGNED` | 7051 / 7223 / 7975 | 3154 / 3750 / 3866 |

Các lời gọi HTTP nội bộ của worker (`matrix`, `matching-state`, `eligibility`) chỉ mất 1–30 ms. Ở lần 4, mỗi đoạn còn khoảng 1 giây, đúng bằng nhịp poll: đó là độ trễ do thiết kế ([điểm nghẽn 7](#7-nhịp-poll-1-giây-của-worker-matching-đã-giảm-trên-local)), không phải do tải.

## Tăng quy mô số tài xế

Tài xế rải trong 6 km (khoảng 1/9 số tài xế nằm trong 2 km quanh điểm đón), 2 chuyến/giây, mỗi bậc 3 phút.

```bash
node deploy/load/accounts.cjs seed --drivers 5000 --riders 80
node deploy/load/run.cjs --drivers 2000 --radius 6000 --rate 2 --duration 3m --warmup 30
node deploy/load/run.cjs --drivers 5000 --radius 6000 --ramp 25 --rate 2 --duration 3m --warmup 30
```

| Số tài xế | GPS / giây | Tới `ASSIGNED` p50 / p95 | Ack GPS p50 / p95 / max | Kết quả |
| --- | --- | --- | --- | --- |
| 500 | khoảng 170 | 3055 / 3704 ms | 2 / 7 / 252 ms | 361/361 chuyến |
| 1000 | khoảng 330 | 3068 / 3959 ms | 1 / 5 / 575 ms | 361/361 chuyến |
| 2000 | khoảng 670 | 3346 / 3995 ms | không ghi được | 361/361 chuyến trong DB; 37 chuyến chờ tới khoảng 5,7 phút; Realtime 122m, PostgreSQL 191m, Redis 66m CPU |
| 3000 (chỉ GPS) | khoảng 1000 | — | 2 / 1613 / 2895 ms | Lên mạng đủ, ack chậm từng đợt; Realtime chỉ 0,15–0,7 core |
| 5000 | — | — | — | Không đạt trạng thái ổn định |

Ở bậc 2000, k6 chỉ ghi 324 lượt hoàn tất. Lý do là 37 chuyến được gán muộn tới khoảng 340 giây, quá thời gian chờ của k6. Nguyên nhân của 37 chuyến chậm này chưa tìm ra, có thể liên quan tới retry và backoff của worker Matching ([điểm nghẽn 8](#8-lỗi-matching-bị-nuốt-và-backoff-tới-30-giây)). Ở 3000 tài xế, ack chậm từng đợt trong khi CPU thấp, chưa tách được do Realtime hay do port-forward.

Các điểm gãy khi lên 5000 tài xế, theo thứ tự gặp:

| Mức | Hiện tượng | Nguyên nhân | Xử lý |
| --- | --- | --- | --- |
| Khoảng 500 kết nối | `UND_ERR_SOCKET other side closed` | Edge `worker_connections 1024`, một worker; mỗi WebSocket chiếm 2 kết nối | Đã nâng trên local |
| Khoảng 3000–4000 | 3601 tài xế mất kết nối cùng lúc | Edge RAM 128 MiB, cgroup ghi `oom_kill 3` | Đã nâng lên 512 MiB trên local |
| Hàng nghìn tài xế cùng lên mạng hoặc kết nối lại | driver-api dùng 1–1,4 core, probe timeout, liveness restart; sau đó `503 DEPENDENCY_UNAVAILABLE` ở `refresh`, `selected-vehicle`, `availability` | driver-api một process Node; mỗi tài xế lên mạng gọi Driver khoảng 5 lần | Bộ giả lập thêm `--ramp`; hệ thống chưa sửa ([điểm nghẽn 3](#3-driver-api-quá-tải-khi-nhiều-tài-xế-lên-mạng-cùng-lúc)) |
| Khoảng 4000–4500, kể cả khi lên mạng dần 25 tài xế/giây | Node dùng 5–7,5/10 core, trong đó 2–4,8 core ngoài các pod của app (kube-apiserver tới 1 core); kubelet, Redis, PostgreSQL probe timeout | Mọi kết nối đi qua `kubectl port-forward`, tức qua kube-apiserver và kubelet | Giới hạn của môi trường đo; cần đường vào khác |

## Trần thông lượng đặt xe

1000 tài xế trong 6 km, mỗi chuyến được huỷ ngay sau khi gán để tài xế quay lại phục vụ, mỗi mức 2 phút.

```bash
node deploy/load/run.cjs --drivers 1000 --radius 6000 --rate 4 --duration 2m --warmup 30
```

| Mức tải | Kết quả | Tới `ASSIGNED` p50 / p95 | Báo giá p95 | CPU trung bình cao nhất |
| --- | --- | --- | --- | --- |
| 2 chuyến/giây (bậc 1000 tài xế ở trên) | 361/361 | 3,1 / 4,0 giây | 22 ms | dưới 0,1 core mỗi pod |
| 4 chuyến/giây, worker 8 | 394/394, hàng đợi dài dần | 26,6 / 48,0 giây | 39 ms | Gateway 0,33, PostgreSQL 0,23, Trip 0,23 core |
| 4 chuyến/giây, worker 16 | 409/409, không cải thiện | 25,0 / 47,4 giây | 112 ms | tương tự |
| 8 chuyến/giây | 110 được gán, 422 quá 60 giây, 174 lỗi HTTP (3,9%) | 19,3 / 55,9 giây (chỉ chuyến được gán) | 7342 ms | Gateway 0,88, PostgreSQL 0,62, Trip 0,6 core; ack GPS p95 2,6 giây, 1345 timeout |
| 12 chuyến/giây | Không đo được: Realtime restart, k6 kẹt ở bước dọn dữ liệu | — | — | — |

Tách thời gian theo đoạn (p50 / p95), 481 chuyến ở 4 chuyến/giây:

| Đoạn | 2 chuyến/giây | 4 chuyến/giây |
| --- | --- | --- |
| `SEARCHING` → Matching tạo offer | 1,2 / 1,8 giây | 19,3 / 36,4 giây |
| Offer vào outbox → publish | 1,0 / 1,0 giây | 5,9 / 10,9 giây |
| Publish → tài xế accept | 6 / 11 ms | 8 / 32 ms |
| Accept → `ASSIGNED` | 1,0 / 1,0 giây | 1,0 / 2,0 giây |

Thời gian dồn lại ở hai hàng đợi outbox, đúng với trần tính từ code ([điểm nghẽn 1](#1-hai-hàng-đợi-outbox-giới-hạn-khoảng-3-chuyếngiây)). Ở 4 chuyến/giây, mọi service vẫn dùng ít CPU, nên tăng tài nguyên hay tăng `WORKER_CONCURRENCY` đều không giúp. Ở 8 chuyến/giây, hàng trăm khách đang chờ cùng poll, kéo Gateway, Trip và PostgreSQL lên gần 1 core và làm cả báo giá lẫn GPS chậm theo.

## Kịch bản cao nhất đạt được

Tìm mức tải cao nhất còn đạt ngưỡng trong [kế hoạch](ke-hoach-kiem-thu-hieu-nang.md#5-ngưỡng-đạtkhông-đạt-đề-xuất): tới `ASSIGNED` p95 ≤ 10 giây, báo giá p95 ≤ 300 ms, ack GPS p95 ≤ 200 ms, lỗi HTTP < 0,5%. Đo ngày 2026-10-29, tài xế rải trong 6 km, mỗi mức 3 phút (mức 1000 tài xế, 2 chuyến/giây lấy từ bậc 1000 tài xế ở [Tăng quy mô](#tăng-quy-mô-số-tài-xế)).

```bash
node deploy/load/run.cjs --drivers 1000 --radius 6000 --gps-ms 10000 --rate 2.5 --duration 3m --warmup 30
```

| Tài xế online | Chuyến/giây | GPS | Được gán | Tới `ASSIGNED` p50 / p95 | Báo giá p95 / p99 | Ack GPS p95 | Đạt? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1000 | 2 | 3 giây | 361/361 | 3,1 / 4,0 giây | 22 ms | 5 ms | **Đạt** |
| 1000 | 2,5 | 10 giây | 451/451 | 11,0 / 13,3 giây | 535 / 2401 ms | 115 ms | Không: vượt ngưỡng thời gian gán và báo giá |
| 1000 | 3 | 10 giây | 538/538 | 16,6 / 30,6 giây | 64 / 409 ms | 10 ms | Không: hàng đợi dài dần |
| 2000 | 2 | 3 giây | 361/361 | 3,3 / 4,0 giây (k6) | 47 ms | không ghi được | Không chắc: 37 chuyến (10%) chờ tới khoảng 5,7 phút |
| 2000 | 2,5 | 10 giây | 276 được gán, 103 quá 60 giây | 8,6 / 45,3 giây | 2338 / 6433 ms | 1368 ms | Không |
| 2000 | 3 | 3 giây | 206 được gán, 240 quá 60 giây | 10,9 / 34,0 giây | 1760 / 4081 ms | 1412 ms | Không |

**Kịch bản cao nhất đạt ngưỡng: khoảng 1000 tài xế online với 2 chuyến/giây** (120 chuyến/phút, khoảng 7200 chuyến/giờ). Trần thật nằm giữa 2 và 2,5 chuyến/giây.

Trần giảm khi có nhiều tài xế hơn. Ở 2000 tài xế và 2,5 chuyến/giây, PostgreSQL lên 0,62 core trung bình (đỉnh 0,89) và driver-api lên 0,4 core. Lý do là mỗi lần tìm phải kiểm eligibility cho khoảng 220 tài xế trong 2 km ([điểm nghẽn 5](#5-realtime-kiểm-eligibility-mọi-tài-xế-trong-2-km-và-giới-hạn-50-tài-xế-phải-khớp-ở-ba-service)), cộng thêm tải GPS. Ở lượt này, 54 chuyến không nhận được offer nào. Ở 1000 tài xế, 3 chuyến/giây, CPU mọi pod vẫn dưới 0,3 core mà hàng đợi vẫn dài: trần nằm ở hai outbox ([điểm nghẽn 1](#1-hai-hàng-đợi-outbox-giới-hạn-khoảng-3-chuyếngiây)).

Số liệu này lấy trên một node local, đi qua port-forward. Đây là mức trần của cấu hình hiện tại, không phải năng lực production.

## Kịch bản 3000 khách và 3500 tài xế

Câu hỏi: nếu 3000 người cùng muốn đặt xe khi có khoảng 3500 tài xế rảnh, hệ thống có đáp ứng được không?

**Trả lời: không, với cấu hình hiện tại.** Số tài xế đủ, nhưng hệ thống chỉ gán khoảng 2,5–3 chuyến/giây (150–180 chuyến/phút).

Ước tính khi khách giữ chuyến (không huỷ): mỗi chuyến sinh khoảng 5 tin outbox Trip và 3 tin outbox Matching, nên trần vào khoảng 3–4 chuyến/giây, tức **13–17 phút** để gán hết 3000 chuyến. Theo trần đo được có huỷ chuyến, con số là 15–20 phút. Muốn gán 3000 chuyến trong khoảng 2 phút (25 chuyến/giây), thông lượng cần tăng khoảng 8–10 lần.

Kịch bản trọn vẹn (`run.cjs --drivers 3500 --ramp 25 --trips 3000 --rate 25`) chưa đo được trên máy này. 3500 tài xế lên mạng đủ, nhưng ngay khi đợt đặt xe bắt đầu, `cri-dockerd` (lớp runtime xử lý cả `kubectl port-forward` lẫn `exec`) sập. Node chuyển `NotReady`, 0 chuyến được tạo, phải khởi động lại Docker Desktop (dữ liệu giữ nguyên). Vì vậy câu trả lời dựa trên [trần thông lượng](#trần-thông-lượng-đặt-xe) đo riêng.

## Điểm nghẽn tìm được

Xếp theo mức ưu tiên xử lý.

### 1. Hai hàng đợi outbox giới hạn khoảng 3 chuyến/giây

Mọi chuyến đi qua hai outbox. Mỗi outbox xử lý một lô cố định mỗi nhịp:

| Outbox | Giới hạn mỗi nhịp | Tin mỗi chuyến (đo, có huỷ) | Trần ước tính |
| --- | --- | --- | --- |
| Trip ([dispatcher.ts](../service/trip-service/src/infrastructure/outbox/dispatcher.ts)): `OUTBOX_BATCH_SIZE=20`, nghỉ `OUTBOX_POLL_INTERVAL_MS=1000` sau mỗi lô | 20 tin | 7,3 (search, cancel tới Matching; event tới Gateway và Notification) | khoảng 2,7 chuyến/giây |
| Matching ([publisher.ts](../service/matching-service/src/infrastructure/publisher.ts)): tối đa 10 tin mỗi `tick`, viết cứng; chạy chung nhịp `WORKER_SCAN_MS=1000` với worker | 10 tin | 3,6 (offer, ASSIGNMENT_PENDING, ASSIGNED, REVOKED) | khoảng 2,8 chuyến/giây |

Vượt trần thì tin bị dồn: tin `search` chờ sau các tin event, offer chờ publish.

Hướng xử lý:
- Trip: lặp ngay khi lô đầy thay vì nghỉ 1 giây, tăng `OUTBOX_BATCH_SIZE`, tách hàng `search` khỏi event.
- Matching: publisher chạy tới khi hết tin, độc lập với nhịp worker.
- Đo lại ở 4, 8, 16 chuyến/giây.

### 2. Rate limit đăng nhập tính theo IP của proxy

Gateway giới hạn `register`, `login`, `otp/request`, `otp/verify` theo `request.getRemoteAddr()`. Sau edge nginx, đó là IP của pod edge, nên mọi người dùng chung một quota. Mặc định trong `application.yaml` chỉ là **5 lượt/phút** cho mỗi endpoint; local từng đặt 30, nay 1000 để seed 3000 khách. OTP mock của Driver giới hạn 10 lượt/phút theo IP của Gateway, vì Gateway không gửi `X-Driver-Client-IP`, nên cả hệ thống chỉ đăng nhập được 10 tài xế mỗi phút. Ở benchmark, seed 50 tài xế qua Gateway mất khoảng 5 phút vì giới hạn này; bộ công cụ hiện tránh nó bằng cách lấy OTP ngay trong pod driver-api.

Hướng xử lý: Gateway đọc IP thật từ header của edge (cấu hình proxy tin cậy), và chuyển `X-Driver-Client-IP` cùng `X-Driver-Proxy-Token` cho Driver.

### 3. driver-api quá tải khi nhiều tài xế lên mạng cùng lúc

Mỗi tài xế lên ca gọi Driver khoảng 5 lần (refresh token ký RS256, đặt OFFLINE, chọn xe, đặt ONLINE), cộng thêm kiểm tra eligibility khi Realtime tìm tài xế gần. Một process Node của driver-api bão hòa ở khoảng 1 core. Khi đó probe timeout, liveness restart pod, và mọi tài xế đang thao tác nhận `503`. Ngoài thực tế, tình huống này xảy ra khi edge hoặc Realtime restart và hàng nghìn app tài xế cùng kết nối lại.

Hướng xử lý: nhiều replica driver-api, liveness probe không gọi tới các phụ thuộc chậm, client kết nối lại có jitter và backoff.

### 4. Edge nginx chưa cấu hình cho WebSocket số lượng lớn

`worker_connections 1024` với một worker chỉ đủ khoảng 500 WebSocket; RAM 128 MiB bị OOM ở vài nghìn kết nối. Worker nginx bị kill thì mọi tài xế mất kết nối cùng lúc, và đợt kết nối lại dồn sang điểm nghẽn 3. Local đã nâng lên 16384 kết nối và 512 MiB. Cấu hình triển khai thật cần tính theo số tài xế online lúc cao điểm.

### 5. Realtime kiểm eligibility mọi tài xế trong 2 km, và giới hạn 50 tài xế phải khớp ở ba service

Realtime kiểm eligibility với Driver cho **mọi** tài xế trong bán kính 2 km (tuần tự từng lô 100, chung timeout `DRIVER_TIMEOUT_MS=2500`), rồi mới cắt còn 50 người gần nhất. Hơn `NEARBY_MAX_CANDIDATES=5000` thì trả lỗi luôn. Ở khu đông tài xế, chi phí mỗi lần tìm tăng theo mật độ.

Ba service cùng giữ giới hạn 50 tài xế:
- Realtime: `maximumResults = 50`, viết cứng trong [nearby.policy.ts](../service/realtime-service/src/domain/policies/nearby.policy.ts).
- Routing: trả `ROUTING_BUSY` cho cả lần tìm nếu nhận hơn `MATRIX_MAX_CANDIDATES` ([matrix.ts](../service/routing-service/src/application/use-cases/matrix.ts)).
- Matching: từ chối response có `entries` hơn 50 ([clients.ts](../service/matching-service/src/infrastructure/clients.ts)).

Hiện chưa lỗi vì Realtime cắt trước. Nhưng hạ `MATRIX_MAX_CANDIDATES` xuống dưới 50, hoặc chỉ nâng một trong ba giá trị, sẽ làm mọi lần tìm ở khu đông lỗi.

### 6. Rate limit Routing mặc định (đã chỉnh trên local)

Matching gọi `POST /routes/matrix` cho mỗi lần tìm. Routing đếm mỗi tài xế ứng viên là một element, chia lô 25 element, mỗi lô một lời gọi OSRM cần một permit. Mặc định `RATE_LIMIT_MATRIX_ELEMENTS_PER_MINUTE=100`, `RATE_LIMIT_REQUESTS_PER_SECOND=2`, `RATE_LIMIT_BURST=2` ([config.ts](../service/routing-service/src/bootstrap/config.ts)); báo giá dùng chung permit. Với 50 tài xế, toàn hệ thống chỉ tìm được khoảng 2 lần mỗi phút, còn lại nhận `503 ROUTING_BUSY`: 4/4 lời gọi thử bị từ chối, và có 658 lần retry trong 8 phút.

Sau khi nâng lên 20000 element/phút, 50 request/giây, burst 20, cùng lời gọi đó trả `200` trong 1–31 ms. Ở 2 chuyến/giây, matching dùng khoảng 6000 element/phút. Giá trị mặc định vẫn hợp lý cho OSRM công cộng; mức mới chưa phải năng lực tối đa đã đo của OSRM.

### 7. Nhịp poll 1 giây của worker Matching (đã giảm trên local)

[worker.ts](../service/matching-service/src/worker.ts) gọi `tick` mỗi `WORKER_SCAN_MS=1000` ms, bỏ qua nhịp nếu nhịp trước chưa xong, và mỗi nhịp nhận tối đa `WORKER_CONCURRENCY` job (mặc định 2). Mỗi chuyến cần ít nhất 2 job, cộng thêm các lần kiểm tra offer mỗi 1 giây. Với mặc định 2, ở 1 chuyến/giây job phải xếp hàng khoảng 3 giây ở mỗi bước (benchmark lần 2). Local đặt 8 cho riêng matching-worker; đặt 16 không giúp thêm, vì trần đã chuyển sang outbox.

Ngay cả khi rảnh, một chuyến vẫn qua 3–4 vòng chờ khoảng 1 giây: outbox Trip, nhịp worker, nhịp publisher, nhịp worker sau khi accept, tổng khoảng 3 giây. Có thể giảm bằng cách hạ nhịp poll (đổi lại là nhiều query PostgreSQL hơn), hoặc đánh thức worker và publisher ngay khi có việc (`LISTEN/NOTIFY`, hoặc publish ngay sau khi commit offer).

### 8. Lỗi matching bị nuốt và backoff tới 30 giây

Worker bắt mọi lỗi bằng `catch {}` rồi retry với backoff 1 → 2 → 4 → 8 → 16 → 30 giây ([worker.ts](../service/matching-service/src/application/worker.ts)). Log chỉ có `tripId` và `delayMs`, không có mã lỗi. Ở benchmark lần 1, phải tái hiện thủ công mới biết lỗi là `ROUTING_BUSY`. Các lần retry ở benchmark lần 2 và 37 chuyến chậm ở bậc 2000 tài xế chưa rõ nguyên nhân vì lý do này.

Hướng xử lý: ghi mã lỗi vào log retry, giới hạn backoff khi lỗi là `ROUTING_BUSY`.

### 9. Poll trạng thái làm khuếch đại tải khi chờ lâu

Bộ k6 poll mỗi 300 ms; app thật không poll mà nhận `trip.event` qua `/ws` của Gateway rồi mới gọi REST ([trip-events.ts](../app/src/features/backend/trip-events.ts)). Vì vậy số liệu CPU của Gateway, Trip, PostgreSQL ở các lần đo cao hơn thực tế, nhất là khi khách chờ lâu (8 chuyến/giây). Cần thêm kịch bản `/ws` (TC-RT-03 trong kế hoạch) và đo lại.

### 10. Thêm một bước HTTP cho mỗi offer

Khi nhận event offer từ RabbitMQ, Realtime gọi `GET /internal/matching/offers/:id` sang Matching rồi mới đẩy qua Socket.IO ([consumer.ts](../service/realtime-service/src/infrastructure/offers/consumer.ts)). Đoạn publish → accept vẫn chỉ mất 6–8 ms p50, kể cả ở 4 chuyến/giây, nên hiện chưa gây ảnh hưởng.

## Giới hạn của lần đo

- Chưa có metrics và tracing phía service (P1.4). Số đo đến từ client, cgroup, thống kê PostgreSQL và mốc thời gian trong DB; nguyên nhân được tìm bằng log, DB và tái hiện thủ công.
- Một node local, một replica mỗi service. Không suy ra năng lực production từ các số này.
- Mọi tải đi qua `kubectl port-forward`. Từ khoảng 4000 kết nối, port-forward và control plane dùng 2–5 core; ở 3500 kết nối cộng một đợt đặt xe, `cri-dockerd` đã sập. Trên máy này nên giữ dưới khoảng 2000 tài xế.
- Tài xế giả lập nhận offer ngay; khách không từ chối hay huỷ giữa chừng. Bộ k6 poll thay vì dùng `/ws`.
- Các lần đo dùng GPS mỗi 3 giây, nặng gấp 3 so với app.
- Báo cáo này không gồm kiểm thử chạy lâu (soak), đặt chuyến trùng và đăng nhập; tóm tắt các test đó nằm trong [kế hoạch](ke-hoach-kiem-thu-hieu-nang.md).

## Bước tiếp theo

Mọi đề xuất cải tiến, kèm công sức, chi phí, đối chiếu ADR và lộ trình đo lại, nằm trong [đề xuất cải tiến hiệu năng](de-xuat-cai-tien-hieu-nang.md). Ưu tiên đầu tiên là gỡ hai hàng đợi outbox và nhịp worker Matching ([điểm nghẽn 1](#1-hai-hàng-đợi-outbox-giới-hạn-khoảng-3-chuyếngiây)), rồi đo lại trần thông lượng.
