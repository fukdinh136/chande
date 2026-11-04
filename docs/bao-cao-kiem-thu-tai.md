# Báo cáo kiểm thử tải

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Toàn hệ thống |
| Rà soát | 2026-11-04 |
| Quy ước | [Format và số liệu](quy-uoc-tai-lieu.md) |

Kết quả ba nhóm kiểm thử hiệu năng cho mục P2.6 trong [kiến trúc mục tiêu](kien-truc-muc-tieu.md). Kế hoạch, test case và ngưỡng đạt/không đạt nằm trong [kế hoạch kiểm thử hiệu năng](ke-hoach-kiem-thu-hieu-nang.md); công cụ và cách chạy nằm trong [deploy/load](../deploy/load/README.md). Ba nhóm gồm: benchmark luồng đặt xe trước và sau tối ưu, tăng quy mô số tài xế, và trần thông lượng cùng kịch bản 3000 khách. Mọi lần đo chạy trên stack Kubernetes local, mục tiêu là tìm điểm nghẽn và so trước/sau, không phải nghiệm thu năng lực production.

Các mục từ [Môi trường](#môi-trường) tới [Kịch bản 3000 khách](#kịch-bản-3000-khách-và-3500-tài-xế) là lần đo gốc ngày 2026-10-28/29. Kết quả sau khi làm [ADR-0008](adr/0008-xu-ly-hang-doi-lien-tuc.md) nằm ở [Đo lại sau ADR-0008](#đo-lại-sau-adr-0008).

## Kết luận

| Câu hỏi | Trả lời ngắn | Mục |
| --- | --- | --- |
| Luồng đặt xe có chạy ở tải thấp không? | Ban đầu không: chỉ 1/270 chuyến tìm được tài xế vì rate limit của Routing. Sau khi chỉnh cấu hình: 100% chuyến được gán, p95 4,0 giây ở 1–2 chuyến/giây | [Benchmark](#benchmark-luồng-đặt-xe) |
| Hệ thống gán được bao nhiêu chuyến mỗi giây? | Lần đo gốc: trần khoảng **2,5–3 chuyến/giây**, nằm ở hai hàng đợi outbox. Sau ADR-0008 và index outbox Matching: trần nằm giữa **6 và 8 chuyến/giây**, ở CPU của PostgreSQL và driver-api | [Đo lại sau ADR-0008](#đo-lại-sau-adr-0008), [điểm nghẽn 1](#1-hai-hàng-đợi-outbox-giới-hạn-khoảng-3-chuyếngiây) |
| Kịch bản cao nhất còn đạt ngưỡng? | Sau ADR-0008 và index outbox Matching: **1000 tài xế online, 6 chuyến/giây** (khoảng 21600 chuyến/giờ): p95 tới `ASSIGNED` 6,7 giây, 0% lỗi. Chỉ ADR-0008: 4 chuyến/giây. Lần đo gốc: 2 chuyến/giây | [Sau khi thêm index](#sau-khi-thêm-index-outbox-matching), [kịch bản cao nhất gốc](#kịch-bản-cao-nhất-đạt-được) |
| 3000 khách cùng đặt khi có 3500 tài xế rảnh thì sao? | **Chưa đáp ứng được.** Tài xế đủ, nhưng lần đo gốc cần khoảng 13–20 phút để gán hết 3000 chuyến; giờ ước tính còn khoảng 8–10 phút (chưa đo trực tiếp). Đặt trong 1–2 phút thì phần lớn khách vẫn phải chờ quá 1 phút | [Kịch bản 3000 khách](#kịch-bản-3000-khách-và-3500-tài-xế) |
| Chịu được bao nhiêu tài xế online? | 500, 1000, 2000 tài xế ổn ở 2 chuyến/giây. Khi lên 5000, gãy lần lượt ở edge nginx, driver-api, rồi chính môi trường đo | [Tăng quy mô](#tăng-quy-mô-số-tài-xế) |

Hai hàng đợi outbox ([điểm nghẽn 1](#1-hai-hàng-đợi-outbox-giới-hạn-khoảng-3-chuyếngiây)) đã được gỡ bằng ADR-0008, và outbox Matching đã có index ([điểm nghẽn 11](#11-publisher-matching-quét-toàn-bảng-outbox)). Việc cần làm tiếp theo là tìm câu SQL tốn CPU nhất của PostgreSQL, giảm tải eligibility của driver-api, rồi rate limit đăng nhập theo IP của proxy ([điểm nghẽn 2](#2-rate-limit-đăng-nhập-tính-theo-ip-của-proxy)).

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

## Đo lại sau ADR-0008

Ngày 2026-11-04, commit `a0fe3c3` trên nhánh `perf/adr-0008-trip-outbox`. Phần đã làm của [ADR-0008](adr/0008-xu-ly-hang-doi-lien-tuc.md):
- A1: outbox Trip lặp ngay khi lô 100 tin đầy.
- A2: publisher Matching chạy vòng riêng và được đánh thức ngay khi worker commit offer.
- A3: worker Matching chạy dạng pool tối đa 16 job; search có offer chờ được hẹn lại lúc offer hết hạn.
- A5: nghỉ 250 ms khi rảnh.

Môi trường giống [lần đo gốc](#môi-trường), chỉ khác là matching-worker không còn ghi đè `WORKER_CONCURRENCY`. Kịch bản: 1000 tài xế trong 6 km, GPS mỗi 3 giây, mỗi chuyến huỷ ngay sau khi gán. Mỗi mức đo 2 phút, riêng mức 2 chuyến/giây đo 3 phút như lần gốc.

```bash
node deploy/load/run.cjs --drivers 1000 --radius 6000 --rate 4 --duration 2m --warmup 30
node deploy/load/segments.cjs --since <started> --until <finished>
```

Kết quả phía khách (k6), so với các mức tương ứng ở [Trần thông lượng](#trần-thông-lượng-đặt-xe) và [Kịch bản cao nhất](#kịch-bản-cao-nhất-đạt-được):

| Chuyến/giây | Trước: được gán; tới `ASSIGNED` p50 / p95 | Sau: được gán; tới `ASSIGNED` p50 / p95 | Sau: báo giá p95 | Sau: ack GPS p95 | Sau: lỗi HTTP | Đạt ngưỡng? |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 301/301 (50 tài xế, 2 km); 3,1 / 4,0 giây | 121/121; 0,9 / 2,2 giây | 334 ms | 163 ms | 0% | Báo giá vượt ngưỡng; xem ghi chú sự cố bên dưới |
| 2 | 361/361; 3,1 / 4,0 giây | 361/361; 0,9 / 1,6 giây | 172 ms | 92 ms | 0% | **Đạt** |
| 4 | 394/394, hàng đợi dài dần; 26,6 / 48,0 giây | 481/481; 0,6 / 0,9 giây | 40 ms | 9 ms | 0% | **Đạt** |
| 5 | — | 601/601; 0,9 / 5,6 giây | 417 ms | 312 ms | 0% | Không: báo giá và GPS vượt ngưỡng |
| 6 | — | 721/721; 1,8 / 21,5 giây | 1009 ms | 425 ms | 0% | Không |
| 8 | 110 được gán, 422 quá 60 giây; 19,3 / 55,9 giây | 513 được gán, 196 quá 60 giây; 0,9 / 50,6 giây | 2005 ms | 956 ms | 3,9% | Không |

Ngưỡng theo [kế hoạch](ke-hoach-kiem-thu-hieu-nang.md#5-ngưỡng-đạtkhông-đạt-đề-xuất): tới `ASSIGNED` p95 ≤ 10 giây, báo giá p95 ≤ 300 ms, ack GPS p95 ≤ 200 ms, lỗi HTTP < 0,5%.

Tách theo đoạn từ mốc thời gian trong DB (p50 / p95), bằng [segments.cjs](../deploy/load/segments.cjs). Cột "trước" dùng cùng script trên dữ liệu của lần đo gốc, vẫn còn trong DB:

| Đoạn | 2/giây trước | 2/giây sau | 4/giây trước | 4/giây sau | 6/giây sau |
| --- | --- | --- | --- | --- | --- |
| `SEARCHING` → Matching tạo offer | 1,00 / 1,94 giây | 0,35 / 1,11 giây | 21,7 / 53,1 giây | 0,35 / 0,58 giây | 1,31 / 11,5 giây |
| Offer → publish lên RabbitMQ | 931 / 952 ms | 7 / 54 ms | 4913 / 8017 ms | 7 / 29 ms | 37 / 231 ms |
| Publish → tài xế accept | 7 / 17 ms | 6 / 24 ms | 7 / 53 ms | 5 / 16 ms | 12 / 70 ms |
| Accept → Trip `ASSIGNED` | 1,00 / 1,04 giây | 0,25 / 0,27 giây | 3,98 / 7,03 giây | 0,25 / 0,27 giây | 0,26 / 10,1 giây |
| Tổng `SEARCHING` → `ASSIGNED` | 2,91 / 3,88 giây | 0,62 / 1,52 giây | 30,8 / 78,9 giây | 0,57 / 0,78 giây | 1,59 / 21,4 giây |

Tổng của cột "4/giây trước" trong DB lớn hơn số của k6 (48,0 giây), vì DB tính cả các chuyến được gán sau khi k6 đã thôi chờ ở 60 giây.

Đối chiếu tiêu chí đo lại của ADR-0008:

| Tiêu chí | Kết quả |
| --- | --- |
| 1000 tài xế, 4 chuyến/giây: `SEARCHING` → `ASSIGNED` p95 ≤ 10 giây, không tăng dần | **Đạt**: 0,78 giây (DB), 0,94 giây (k6); 481/481 chuyến |
| Đoạn offer → publish p95 ≤ 200 ms | **Đạt**: 29 ms ở 4 chuyến/giây; 128 ms ở 5 chuyến/giây |
| 1000 tài xế, 1 chuyến/giây: p95 ≤ 2 giây | **Sát ngưỡng, chưa đạt theo k6**: 2,21 giây (k6), 1,83 giây (DB); 121/121 chuyến, p50 0,9 giây. Đo sau khi khởi động lại Docker Desktop, cùng lúc báo giá p95 334 ms, cao hơn mức 4 chuyến/giây đo trước đó (40 ms), nên đuôi chậm có thể do môi trường; chưa xác minh. Cần đo lại |

**Kết luận:**
- Mức cao nhất đạt mọi ngưỡng tăng từ 2 lên **4 chuyến/giây**, tức khoảng 14400 chuyến/giờ.
- Ở 2 chuyến/giây, p95 tới `ASSIGNED` giảm từ 4,0 xuống 1,6 giây.
- Ở 5 và 6 chuyến/giây, mọi chuyến vẫn được gán và không có lỗi HTTP, nhưng chậm dần.

Trần đã chuyển chỗ. Trước đây, ở 4 chuyến/giây, mọi pod dùng dưới 0,35 core mà hàng đợi vẫn dài. Bây giờ hàng đợi không còn là điểm nghẽn, mà các service bắt đầu thật sự tốn CPU:

| Pod (CPU trung bình, millicore) | 4/giây | 5/giây | 6/giây | 8/giây |
| --- | --- | --- | --- | --- |
| postgres | 307 | 820 | 1022 | 1026 |
| driver-api | 179 | 464 | 595 | 594 |
| gateway-api | 123 | 207 | 415 | 727 |
| trip-api | 90 | 251 | 414 | 533 |
| realtime-api | 126 | 261 | 309 | 313 |
| matching-worker | 57 | 121 | 141 | 118 |

PostgreSQL chạm khoảng 1 core từ 6 chuyến/giây, kéo theo báo giá, ack GPS và callback gán của Trip cùng chậm: đoạn accept → `ASSIGNED` p95 lên 10 giây ở 6 chuyến/giây. Có hai nguồn tải đã biết:
- Publisher Matching quét toàn bảng outbox ([điểm nghẽn 11](#11-publisher-matching-quét-toàn-bảng-outbox)).
- Eligibility của tài xế trong 2 km ([điểm nghẽn 5](#5-realtime-kiểm-eligibility-mọi-tài-xế-trong-2-km-và-giới-hạn-50-tài-xế-phải-khớp-ở-ba-service)).

Chưa tách được phần CPU của từng nguồn. Ở 8 chuyến/giây, khách chờ lâu cùng poll, nên Gateway và Trip tăng thêm ([điểm nghẽn 9](#9-poll-trạng-thái-làm-khuếch-đại-tải-khi-chờ-lâu)).

Với kịch bản 3000 khách, gán ổn định ở khoảng 4–5 chuyến/giây cho ước tính khoảng 10–12 phút để gán hết 3000 chuyến (lần đo gốc ước tính 13–20 phút). Sau khi thêm index, con số này còn khoảng 8–10 phút ([bên dưới](#sau-khi-thêm-index-outbox-matching)). Các ước tính này chưa được đo trực tiếp.

Sự cố trong lần đo: ngay sau 4 mức đo liên tiếp (4, 8, 6, 5 chuyến/giây), lần đo 2 chuyến/giây đầu tiên làm `cri-dockerd` sập. Node chuyển `NotReady`, Realtime restart, và 1000 tài xế mất kết nối. Đây là cùng giới hạn của môi trường đo đã nêu ở [Giới hạn](#giới-hạn-của-lần-đo). Sau khi khởi động lại Docker Desktop (dữ liệu giữ nguyên), mức 2 chuyến/giây được đo lại; số trong bảng là của lần đo lại. Hai mức 2 và 1 chuyến/giây đều đo sau khi khởi động lại, và đều có đuôi chậm hơn mức 4 chuyến/giây đo trước đó: báo giá p95 172 và 334 ms so với 40 ms, ack GPS p95 92 và 163 ms so với 9 ms. Tải thấp hơn mà chậm hơn cho thấy môi trường sau khởi động lại chậm hơn, nhưng chưa tìm ra nguyên nhân. Nên đo lại hai mức này trên một môi trường ổn định.

### Sau khi thêm index outbox Matching

Cùng ngày 2026-11-04, sau khi thêm migration `MatchingOutboxPending1793750400000` ([điểm nghẽn 11](#11-publisher-matching-quét-toàn-bảng-outbox)). Kịch bản giống trên. Câu claim của publisher chuyển từ quét toàn bảng sang `Index Scan using matching_outbox_pending`, mất 0,017 ms. Khi rảnh, số lần quét toàn bảng `matching_outbox` trong 10 giây giảm từ 40 lần (2,26 triệu dòng) xuống 0.

| Chuyến/giây | Chỉ ADR-0008: được gán; tới `ASSIGNED` p50 / p95 | Thêm index: được gán; tới `ASSIGNED` p50 / p95 | Báo giá p95 (trước → sau) | Ack GPS p95 (trước → sau) | Lỗi HTTP sau | Đạt ngưỡng sau? |
| --- | --- | --- | --- | --- | --- | --- |
| 5 | 601/601; 0,9 / 5,6 giây | 601/601; 0,9 / 2,9 giây | 417 → 266 ms | 312 → 153 ms | 0% | **Đạt** |
| 6 | 721/721; 1,8 / 21,5 giây | 721/721; 0,6 / 6,7 giây | 1009 → 154 ms | 425 → 88 ms | 0% | **Đạt** |
| 8 | 513 được gán, 196 quá 60 giây, lỗi 3,9%; 0,9 / 50,6 giây | 946 được gán, 15 quá 60 giây; 14,2 / 44,9 giây | 2005 → 687 ms | 956 → 193 ms | 0% | Không: hàng đợi dài dần |

CPU trung bình (millicore), chỉ ADR-0008 → thêm index:

| Pod | 5/giây | 6/giây | 8/giây |
| --- | --- | --- | --- |
| postgres | 820 → 517 | 1022 → 459 | 1026 → 1003 |
| driver-api | 464 → 373 | 595 → 328 | 594 → 726 |
| gateway-api | 207 → 244 | 415 → 156 | 727 → 554 |
| trip-api | 251 → 204 | 414 → 180 | 533 → 536 |

Tách theo đoạn ở 6 chuyến/giây (p50 / p95), chỉ ADR-0008 → thêm index:
- `SEARCHING` → offer: 1,31 / 11,5 giây → 0,39 / 3,0 giây.
- Offer → publish: 37 / 231 ms → 7 / 34 ms.
- Accept → `ASSIGNED`: 0,26 / 10,1 giây → 0,08 / 1,6 giây.

**Kết luận:**
- Mức cao nhất đạt mọi ngưỡng tăng từ 4 lên **6 chuyến/giây** (khoảng 21600 chuyến/giờ), gấp 3 lần lần đo gốc.
- Ở 8 chuyến/giây, gần như mọi chuyến được gán và không có lỗi HTTP, nhưng hàng đợi dài dần.
- Ở 8 chuyến/giây, PostgreSQL vẫn khoảng 1 core và driver-api khoảng 0,7 core. Đây là trần kế tiếp. Chưa biết câu SQL nào tốn nhất, vì chưa bật `pg_stat_statements`. Nguồn đã biết là eligibility của tài xế trong 2 km ([điểm nghẽn 5](#5-realtime-kiểm-eligibility-mọi-tài-xế-trong-2-km-và-giới-hạn-50-tài-xế-phải-khớp-ở-ba-service)) và poll của khách chờ lâu ([điểm nghẽn 9](#9-poll-trạng-thái-làm-khuếch-đại-tải-khi-chờ-lâu)).
- Với 3000 khách, ở khoảng 6 chuyến/giây, ước tính khoảng 8–10 phút để gán hết, vẫn chưa đạt mục tiêu 1–2 phút.

Mức 1 chuyến/giây chưa đo lại sau khi thêm index.

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

**Đã xử lý** bằng [ADR-0008](adr/0008-xu-ly-hang-doi-lien-tuc.md) (A1, A2). Ở 4 chuyến/giây, đoạn offer → publish còn 7 / 29 ms (p50 / p95) và hàng đợi không còn dài dần ([Đo lại sau ADR-0008](#đo-lại-sau-adr-0008)). Tách hàng `search` khỏi event chưa làm.

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

**Đã xử lý** bằng ADR-0008 (A3, A5): worker chạy dạng pool tối đa 16 job, nghỉ 250 ms khi rảnh; publisher được đánh thức ngay khi worker commit offer. Bỏ ghi đè `WORKER_CONCURRENCY=8` trong stack. Ở 2 chuyến/giây, tổng `SEARCHING` → `ASSIGNED` p50 từ 2,9 xuống 0,6 giây. Phần còn lại chủ yếu là khoảng 250 ms chờ ở outbox Trip cho mỗi chiều.

### 8. Lỗi matching bị nuốt và backoff tới 30 giây

Worker bắt mọi lỗi bằng `catch {}` rồi retry với backoff 1 → 2 → 4 → 8 → 16 → 30 giây ([worker.ts](../service/matching-service/src/application/worker.ts)). Log chỉ có `tripId` và `delayMs`, không có mã lỗi. Ở benchmark lần 1, phải tái hiện thủ công mới biết lỗi là `ROUTING_BUSY`. Các lần retry ở benchmark lần 2 và 37 chuyến chậm ở bậc 2000 tài xế chưa rõ nguyên nhân vì lý do này.

Hướng xử lý: ghi mã lỗi vào log retry, giới hạn backoff khi lỗi là `ROUTING_BUSY`.

### 9. Poll trạng thái làm khuếch đại tải khi chờ lâu

Bộ k6 poll mỗi 300 ms; app thật không poll mà nhận `trip.event` qua `/ws` của Gateway rồi mới gọi REST ([trip-events.ts](../app/src/features/backend/trip-events.ts)). Vì vậy số liệu CPU của Gateway, Trip, PostgreSQL ở các lần đo cao hơn thực tế, nhất là khi khách chờ lâu (8 chuyến/giây). Cần thêm kịch bản `/ws` (TC-RT-03 trong kế hoạch) và đo lại.

### 10. Thêm một bước HTTP cho mỗi offer

Khi nhận event offer từ RabbitMQ, Realtime gọi `GET /internal/matching/offers/:id` sang Matching rồi mới đẩy qua Socket.IO ([consumer.ts](../service/realtime-service/src/infrastructure/offers/consumer.ts)). Đoạn publish → accept vẫn chỉ mất 6–8 ms p50, kể cả ở 4 chuyến/giây, nên hiện chưa gây ảnh hưởng.

### 11. Publisher Matching quét toàn bảng outbox

Tìm thấy khi đo lại sau ADR-0008. Câu claim của [publisher.ts](../service/matching-service/src/infrastructure/publisher.ts) lọc `published_at IS NULL AND due_at <= now()` rồi `ORDER BY due_at LIMIT 1`, nhưng `matching_outbox` không có index cho điều kiện này. `EXPLAIN` cho thấy PostgreSQL quét toàn bảng (`Seq Scan`) ở mỗi lần claim. Bảng không bao giờ được dọn: trên stack local đã có khoảng 56000 dòng, gần hết là tin đã publish.

| Đo trên `matching_db` | Giá trị |
| --- | --- |
| 10 giây khi rảnh | 40 lần quét toàn bảng, khoảng 2,26 triệu dòng đọc (khoảng 225000 dòng/giây) |
| Tích lũy từ lúc PostgreSQL khởi động | `matching_outbox` 2,45 tỉ dòng đọc bằng quét toàn bảng; mọi bảng khác của Matching cộng lại dưới 4 triệu |

A2 làm điểm này nặng hơn: publisher claim từng tin một và chạy tới khi hết tin, nên mỗi tin là một lần quét. Đây là ứng viên chính cho việc PostgreSQL lên 0,8–1 core ở 5–6 chuyến/giây, nhưng chưa tách được bao nhiêu phần CPU là do câu này, vì chưa bật `pg_stat_statements`.

Hướng xử lý: partial index `ON matching_outbox(due_at) WHERE published_at IS NULL` (giống `outbox_pending` của Trip), và dọn hoặc chuyển tin đã publish sang bảng lưu trữ theo lịch. Sau đó đo lại 5 và 6 chuyến/giây.

**Đã thêm index** (migration `MatchingOutboxPending1793750400000` trong [persistence.ts](../service/matching-service/src/infrastructure/persistence.ts), có test tích hợp kiểm planner dùng được index). Kết quả: 5 và 6 chuyến/giây chuyển từ không đạt sang đạt mọi ngưỡng ([Sau khi thêm index](#sau-khi-thêm-index-outbox-matching)). Việc dọn tin đã publish chưa làm: bảng vẫn lớn dần, nhưng index chỉ chứa tin chưa publish nên claim không còn chậm theo kích thước bảng.

## Giới hạn của lần đo

- Chưa có metrics và tracing phía service (P1.4). Số đo đến từ client, cgroup, thống kê PostgreSQL và mốc thời gian trong DB; nguyên nhân được tìm bằng log, DB và tái hiện thủ công.
- Một node local, một replica mỗi service. Không suy ra năng lực production từ các số này.
- Mọi tải đi qua `kubectl port-forward`. Từ khoảng 4000 kết nối, port-forward và control plane dùng 2–5 core; ở 3500 kết nối cộng một đợt đặt xe, `cri-dockerd` đã sập. Trên máy này nên giữ dưới khoảng 2000 tài xế.
- Tài xế giả lập nhận offer ngay; khách không từ chối hay huỷ giữa chừng. Bộ k6 poll thay vì dùng `/ws`.
- Các lần đo dùng GPS mỗi 3 giây, nặng gấp 3 so với app.
- Báo cáo này không gồm kiểm thử chạy lâu (soak), đặt chuyến trùng và đăng nhập; tóm tắt các test đó nằm trong [kế hoạch](ke-hoach-kiem-thu-hieu-nang.md).

## Bước tiếp theo

Mọi đề xuất cải tiến, kèm công sức, chi phí, đối chiếu ADR và lộ trình đo lại, nằm trong [đề xuất cải tiến hiệu năng](de-xuat-cai-tien-hieu-nang.md). Hai hàng đợi outbox và nhịp worker Matching đã được gỡ bằng ADR-0008 ([Đo lại sau ADR-0008](#đo-lại-sau-adr-0008)). Index cho outbox Matching cũng đã thêm ([điểm nghẽn 11](#11-publisher-matching-quét-toàn-bảng-outbox)), đưa mức đạt ngưỡng lên 6 chuyến/giây. Ưu tiên tiếp theo là bật `pg_stat_statements` để biết PostgreSQL tốn CPU ở câu nào, rồi giảm tải eligibility của driver-api ([điểm nghẽn 5](#5-realtime-kiểm-eligibility-mọi-tài-xế-trong-2-km-và-giới-hạn-50-tài-xế-phải-khớp-ở-ba-service)).
