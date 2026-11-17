# Báo cáo kiểm thử tải

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Toàn hệ thống |
| Rà soát | 2026-11-17 |
| Quy ước | [Format và số liệu](quy-uoc-tai-lieu.md) |

Báo cáo kiểm thử hiệu năng cho mục P2.6 trong [kiến trúc mục tiêu](kien-truc-muc-tieu.md), đo ngày 2026-11-04 sau khi hoàn thành nhóm cải tiến A và cải tiến môi trường đo E1–E3 trong [đề xuất cải tiến hiệu năng](de-xuat-cai-tien-hieu-nang.md). Mọi kết quả được so với mốc ban đầu đo ngày 2026-10-28/29 trên cùng máy và cùng kịch bản. Kế hoạch, test case và ngưỡng nằm trong [kế hoạch kiểm thử hiệu năng](ke-hoach-kiem-thu-hieu-nang.md); công cụ nằm trong [deploy/load](../deploy/load/README.md).

Mục tiêu của các lần đo là tìm điểm nghẽn và chứng minh hiệu quả từng cải tiến trên một máy local, không phải nghiệm thu năng lực production.

## 1. Tóm tắt kết quả

| Chỉ số (1000 tài xế online) | Mốc ban đầu, 2026-10-29 | Sau nhóm A và E, 2026-11-04 | Thay đổi |
| --- | --- | --- | --- |
| Mức tải cao nhất còn đạt mọi ngưỡng | 2 chuyến/giây | **6 chuyến/giây** | ×3 |
| Tạo chuyến → `ASSIGNED` p95 ở 2 chuyến/giây | 4,0 giây | **0,9 giây** | −78% |
| Ở 4 chuyến/giây | p95 48,0 giây, hàng đợi dài dần | **p95 0,9 giây**, 480/480 chuyến | Hết xếp hàng |
| Ở 8 chuyến/giây | 110 chuyến được gán, 422 chờ quá 60 giây, lỗi HTTP 3,9% | 961/961 chuyến được gán, lỗi 0% (p95 37 giây) | Không còn mất chuyến |
| Thông lượng gán cao nhất đo được | khoảng 2,5–3 chuyến/giây | **khoảng 10,5 chuyến/giây** (vượt ngưỡng thời gian chờ) | ×3,5–4 |
| Số tài xế online đo được | Gãy trước 5000; môi trường đo sập ở khoảng 3500 kết nối | **5000 tài xế**, 0 lỗi kết nối, p95 1,3 giây | Đo được 5000 |
| Chạy liên tục 30 phút | Chưa đo | 5388/5395 chuyến được gán, RAM mọi pod ổn định; một đợt chậm 3 phút | Ổn định |
| Đăng nhập | Mọi người dùng chung một quota theo IP của proxy | Mỗi IP một quota; 15 lượt/giây p95 77 ms, 0 lỗi | Đúng theo người dùng |
| 3000 khách cùng đặt (ước tính) | 13–20 phút để gán hết | khoảng 5–8 phút | Nhanh gấp 2–3 lần |

Các mức này đo bằng cùng cách đo với mốc ban đầu (GPS mỗi 3 giây, khách poll trạng thái mỗi 300 ms, qua `kubectl port-forward`), trừ hai dòng thông lượng tối đa và số tài xế online, vốn đo bằng cách đo giống app thật ([mục 3.3](#33-hai-cách-đo)).

**Điểm nghẽn hiện tại** không còn ở hàng đợi. Từ khoảng 8 chuyến/giây:
- driver-api (một process Node) chạm 1 core vì kiểm tra điều kiện từng tài xế một ([mục 7.1](#71-driver-api-kiểm-tra-từng-tài-xế-một)).
- PostgreSQL lên khoảng 1 core vì số câu lệnh (khoảng 14000 câu/giây), không phải vì câu lệnh chậm ([mục 7.2](#72-postgresql-bận-vì-số-câu-lệnh)).

Hai điểm này đã có hướng xử lý trong lộ trình (ADR-0001 và nhiều replica driver-api); xem [đề xuất cải tiến](de-xuat-cai-tien-hieu-nang.md).

**Đo lại ngày 2026-11-05 sau B7 và ADR-0001** ([mục 11](#11-đo-lại-sau-b7-và-adr-0001-2026-11-05)): ở cách đo giống app với 1000 tài xế, mức cao nhất còn đạt mọi ngưỡng tăng từ 6 lên **12 chuyến/giây** (p95 0,9 giây, 1441/1441 chuyến được gán); tổng câu SQL ở 12 chuyến/giây giảm từ 2,1 triệu xuống 277 nghìn; 5000 tài xế ở 4 chuyến/giây có p95 1,0 giây với số câu SQL giảm 93%. Trần mới: 16 chuyến/giây (giới hạn Routing cho OSRM) và 5000 tài xế ở 8 chuyến/giây.

**Đo lại ngày 2026-11-10 với observability và giới hạn Routing đúng** ([mục 12](#12-đo-lại-với-observability-2026-11-10)): mức cao nhất đã đo, **32 chuyến/giây, vẫn đạt mọi ngưỡng** (3841/3841 chuyến, p95 1,1 giây) khi tắt observability; chưa tìm thấy trần. Bật observability vẫn đạt ở 24 chuyến/giây, đổi lại CPU các service Node tăng 20–50%. 5000 tài xế ở 8 chuyến/giây đạt. Trần 16 chuyến/giây của lần đo 2026-11-05 là do pod Routing còn giữ giới hạn cũ, không phải do năng lực hệ thống.

## 2. Mục tiêu và phạm vi

| Câu hỏi | Kịch bản trả lời |
| --- | --- |
| Nhóm A có nâng được trần thông lượng như đề xuất không? | Loạt 1: so trực tiếp với mốc ban đầu, cùng cách đo |
| Hệ thống gán được tối đa bao nhiêu chuyến mỗi giây khi khách và tài xế dùng app như thật? | Loạt 2: tăng dần tới khi gãy |
| Chịu được bao nhiêu tài xế online? | Loạt 3: 1000 tới 5000 tài xế |
| Chạy lâu có ổn định không (RAM, bảng outbox, kết nối lại)? | Loạt 4: 30 phút liên tục |
| Đăng nhập chịu được bao nhiêu, rate limit có tính đúng theo người dùng không? | Loạt 5 và kiểm tra A4 |
| Điểm nghẽn tiếp theo nằm ở đâu? | Tách thời gian theo đoạn, CPU từng pod, `pg_stat_statements`, log retry của Matching |

Ngoài phạm vi: kịch bản 3000 khách đặt cùng lúc (chỉ ước tính từ thông lượng đo được), tải trên cụm nhiều máy, tài xế người thật (tài xế giả lập nhận offer ngay).

## 3. Phương pháp

### 3.1 Kịch bản

| Loạt | Tài xế online | Tải | Thời lượng mỗi mức | Cách đo |
| --- | --- | --- | --- | --- |
| 1. So với mốc ban đầu | 1000, rải trong 6 km quanh Hoàn Kiếm | 2, 4, 6, 8, 10 chuyến/giây | 2 phút | Như mốc ban đầu |
| 2. Thông lượng tối đa | 1000 | 2, 4, 6, 8, 10, 12, 16 chuyến/giây | 2 phút | Giống app |
| 3. Tăng quy mô tài xế | 1000, 2000, 3000, 5000 (từ 2000 trở lên, mỗi giây 25 tài xế lên mạng) | 4 chuyến/giây | 3 phút | Giống app |
| 4. Chạy lâu | 1000 | 3 chuyến/giây, khách đăng nhập lại mỗi 10 phút | 30 phút | Giống app |
| 5. Đăng nhập | — | 5, 10, 15 lượt đăng nhập/giây | 1 phút | k6 `login.js` |
| Kiểm chứng thêm | 1000 | 8 chuyến/giây: đo lặp lại; đo với Routing 8 worker | 2 phút | Giống app |

Mỗi chuyến: báo giá → tạo chuyến → chờ tới `ASSIGNED` (tối đa 60 giây) → huỷ ngay để tài xế quay lại phục vụ. Tài xế giả lập gửi GPS qua Socket.IO và nhận mọi offer ngay. Trước mỗi lần đo, phiên tài xế được làm mới và chuyến còn mở của lần trước bị huỷ; giữa hai lần đo nghỉ 20 giây.

### 3.2 Ngưỡng đạt

Theo [kế hoạch](ke-hoach-kiem-thu-hieu-nang.md#4-ngưỡng-đạt): một mức tải **đạt** khi đồng thời có tạo chuyến → `ASSIGNED` p95 ≤ 10 giây, báo giá p95 ≤ 300 ms, ack GPS p95 ≤ 200 ms và lỗi HTTP < 0,5%.

### 3.3 Hai cách đo

| | Như mốc ban đầu | Giống app |
| --- | --- | --- |
| GPS mỗi tài xế | 3 giây | 10 giây, như app |
| Khách chờ gán | Poll `GET /trips/:id` mỗi 300 ms | Một phiên `/ws` của Gateway nhận `trip.assigned`, rồi đọc chuyến một lần, như app |
| Đường vào | Máy host → `kubectl port-forward` → edge | Pod `load-runner` trong cụm → Service `edge` (E1) |
| Dùng cho | So trước/sau công bằng với mốc ban đầu | Năng lực gần thực tế; đo được trên 3500 kết nối |

Cách đo cũ nặng hơn thực tế: GPS gấp 3 lần, và mỗi khách đang chờ tạo khoảng 3 request mỗi giây. Ở 8 chuyến/giây, loạt 1 gửi 37372 request HTTP, loạt 2 chỉ 3244.

### 3.4 Số đo và công cụ

| Số đo | Nguồn |
| --- | --- |
| Thời gian tới `ASSIGNED`, báo giá, các bước HTTP | k6, phía khách |
| Thời gian từng đoạn (tạo offer, publish, accept, Trip ghi `ASSIGNED`) | Mốc thời gian trong `trip_db`, `matching_db` ([segments.cjs](../deploy/load/segments.cjs)) |
| Thông lượng gán thực tế | Số chuyến có `ASSIGNED` trong DB chia cho thời gian đo |
| Ack GPS, offer, kết nối lại | Bộ giả lập tài xế |
| CPU, RAM, mạng từng pod | cgroup, lấy mẫu mỗi 10 giây ([pods.cjs](../deploy/load/pods.cjs)) |
| Thời gian PostgreSQL theo câu lệnh | `pg_stat_statements`, reset đúng lúc k6 bắt đầu (E3, [sql-stats.cjs](../deploy/load/sql-stats.cjs)) |
| Lý do Matching phải thử lại | Log `matching_job_retry` có mã lỗi (A7) |

## 4. Môi trường

| Thuộc tính | Giá trị |
| --- | --- |
| Mã nguồn | Nhánh `perf/adr-0008-trip-outbox`, commit `01e786c` |
| Hạ tầng | Docker Desktop Kubernetes một node trên MacBook (VM 10 CPU, khoảng 7,7 GiB); mỗi deployment 1 replica, request 50m CPU, limit 2 CPU |
| Thành phần | Gateway (Java), User (Java), Trip, Matching (API và worker), Routing, Price, Driver, Realtime (Node); PostgreSQL 18, Redis, RabbitMQ, OSRM đồ thị Hà Nội, edge nginx |
| Cấu hình khác mặc định | Gateway `AUTH_MAX_ATTEMPTS=1000` để seed tài khoản kiểm thử; Routing `EXTERNAL_MAP_SELF_HOSTED=true` (A8); edge tính cho 5000 tài xế (A9) |
| Dữ liệu kiểm thử | 5000 tài xế `CAR_4`, 3000 khách; tài khoản sinh bởi [accounts.cjs](../deploy/load/accounts.cjs) |

So với mốc ban đầu: matching-worker không còn ghi đè `WORKER_CONCURRENCY=8` (mặc định mới 16), Routing không còn ba giá trị rate limit chỉnh tay.

## 5. Các cải tiến được kiểm thử

| ID | Cải tiến | Commit |
| --- | --- | --- |
| A1, A5 | Outbox Trip lặp ngay khi lô 100 tin đầy; nghỉ 250 ms khi rảnh ([ADR-0008](adr/0008-xu-ly-hang-doi-lien-tuc.md)) | `f8ecc7f` |
| A2 | Publisher offer của Matching chạy vòng riêng, được đánh thức ngay khi có offer | `2dac6c0` |
| A3 | Worker Matching chạy dạng pool 16 job; search có offer chờ được hẹn lại lúc offer hết hạn | `a0fe3c3` |
| (mới) | Partial index cho câu claim của publisher Matching, trước đó quét toàn bảng outbox | `3d1e440` |
| A4 | Gateway giới hạn đăng nhập theo IP thật và chuyển IP thật xuống Driver | `7a0eec9` |
| A6 | Dọn tin outbox đã gửi sau 24 giờ (Trip và Matching) | `bfac1f3` |
| A7 | Log retry có mã lỗi; dependency bận được thử lại sau `Retry-After`, tối đa 2 giây | `64ede3e` |
| A8 | Mặc định rate limit Routing cho OSRM tự host từ năng lực đo được | `36b8643` |
| A9 | Edge nginx tính kết nối và RAM theo số tài xế lúc cao điểm | `3d034d4` |
| E3, E2, E1 | `pg_stat_statements`; kịch bản `/ws` và GPS 10 giây; bộ đo chạy trong cụm | `924c71c`, `a7c2056`, `01e786c` |

## 6. Kết quả

### 6.1 So với mốc ban đầu

Loạt 1, cùng cách đo với mốc ban đầu (1000 tài xế trong 6 km, GPS 3 giây, poll, qua port-forward):

| Chuyến/giây | Mốc ban đầu: được gán; p95 tới `ASSIGNED` | Sau cải tiến: được gán | p50 / p95 tới `ASSIGNED` | Báo giá p95 | Ack GPS p95 | Lỗi HTTP | Đạt? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2 | 361/361; 4,0 giây | 241/241 | 0,6 / 0,9 giây | 18 ms | 4 ms | 0% | **Đạt** |
| 4 | 394/394, hàng đợi dài dần; 48,0 giây | 480/480 | 0,6 / 0,9 giây | 31 ms | 8 ms | 0% | **Đạt** |
| 6 | Chưa đo (đã gãy từ 2,5) | 720/720 | 0,6 / 1,0 giây | 66 ms | 20 ms | 0% | **Đạt** |
| 8 | 110 được gán, 422 quá 60 giây; 55,9 giây | 961/961 | 18,9 / 37,4 giây | 833 ms | 161 ms | 0% | Không |
| 10 | Chưa đo được | 437/918 | 0,9 / 51,9 giây | 1250 ms | 417 ms | 7,9% | Không |

Cải thiện qua từng giai đoạn, cùng cách đo và cùng ngày đo lại (p95 tới `ASSIGNED`):

| Giai đoạn | 4 chuyến/giây | 5 chuyến/giây | 6 chuyến/giây | 8 chuyến/giây | Mức cao nhất đạt ngưỡng |
| --- | --- | --- | --- | --- | --- |
| Mốc ban đầu (2026-10-29) | 48,0 giây | — | — | 55,9 giây, lỗi 3,9% | 2 chuyến/giây |
| Sau ADR-0008 (A1, A2, A3, A5) | 0,9 giây | 5,6 giây, báo giá 417 ms | 21,5 giây | 50,6 giây, lỗi 3,9% | 4 chuyến/giây |
| Thêm index outbox Matching | — | 2,9 giây | 6,7 giây | 44,9 giây, lỗi 0% | 6 chuyến/giây |
| Thêm A4, A6–A9, E3 | 0,9 giây | — | **1,0 giây** | 37,4 giây, lỗi 0% | 6 chuyến/giây |

Ở bước cuối, p95 tại 6 chuyến/giây giảm từ 6,7 xuống 1,0 giây chủ yếu nhờ hai thay đổi:
- **A8:** giới hạn cũ 20000 element/phút của Routing sát với nhu cầu ở 6 chuyến/giây (mỗi lần tìm tới 50 element, khoảng 18000 element/phút), nên Routing thỉnh thoảng trả `ROUTING_BUSY`.
- **A7:** khi gặp `ROUTING_BUSY`, worker trước đây lùi dần 1, 2, 4… tới 30 giây; nay chỉ chờ theo `Retry-After`, tối đa 2 giây.

### 6.2 Thông lượng tối đa

Loạt 2, đo giống app (GPS 10 giây, `/ws`, trong cụm), 1000 tài xế:

| Chuyến/giây đặt | Được gán (k6) | p50 / p95 tới `ASSIGNED` | Gán thực tế (DB) | Báo giá p95 | Ack GPS p95 | Lỗi HTTP | Đạt? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2 | 241/241 | 0,7 / 1,0 giây | 1,98 chuyến/giây | 32 ms | 3 ms | 0% | **Đạt** |
| 4 | 481/481 | 0,6 / 0,9 giây | 3,96 | 13 ms | 2 ms | 0% | **Đạt** |
| 6 | 721/721 | 0,6 / 1,0 giây | 5,94 | 25 ms | 3 ms | 0% | **Đạt** |
| 8 | 482/733 | 0,7 / 41,3 giây | 3,20 | 159 ms | 3 ms | 0% | Không |
| 8 (đo lặp lại) | 644/811 | 0,8 / 51,7 giây | 4,38 | 172 ms | 7 ms | 0% | Không |
| 10 | 575/878 | 0,7 / 47,7 giây | 3,88 | 132 ms | 3 ms | 0% | Không |
| 12 | 1305/1319 | 22,3 / 50,0 giây | 9,01 | 74 ms | 4 ms | 0% | Không |
| 16 | 1540/1632 | 22,1 / 53,3 giây | **10,47** | 69 ms | 5 ms | 0% | Không |

Kết luận:
- **Mức cao nhất đạt mọi ngưỡng là 6 chuyến/giây**, giống loạt 1, tức khoảng 21600 chuyến/giờ.
- **Thông lượng gán cao nhất đo được là khoảng 10,5 chuyến/giây**, nhưng ở mức này khách chờ trung bình hơn 20 giây.
- Ở 8 và 10 chuyến/giây, thông lượng gán thấp hơn ở 12 và 16 (3,2–4,4 so với 9,0–10,5 chuyến/giây). Đo lặp lại 8 chuyến/giây cho kết quả tương tự; nguyên nhân của sự không đơn điệu này chưa giải thích được với số liệu hiện có ([mục 9](#9-giới-hạn-của-lần-đo)).
- Báo giá, ack GPS và lỗi HTTP vẫn đạt ngưỡng ở mọi mức. Cách đo giống app không còn khuếch đại tải bằng poll; chỉ bước tìm tài xế chậm lại.

### 6.3 Tách thời gian theo đoạn

p50 / p95, tính từ mốc thời gian trong DB. Cột "mốc ban đầu" tính bằng cùng script trên dữ liệu ngày 2026-10-29.

| Đoạn | 2/giây, mốc ban đầu | 2/giây, sau | 4/giây, mốc ban đầu | 4/giây, sau | 6/giây, sau (giống app) |
| --- | --- | --- | --- | --- | --- |
| `SEARCHING` → Matching tạo offer | 1,00 / 1,94 giây | 0,3 / 0,5 giây | 21,7 / 53,1 giây | 0,3 / 0,5 giây | 0,3 / 0,6 giây |
| Offer → publish lên RabbitMQ | 931 / 952 ms | 3 / 6 ms | 4913 / 8017 ms | 4 / 12 ms | 5 / 15 ms |
| Publish → tài xế accept | 7 / 17 ms | 4 / 7 ms | 7 / 53 ms | 4 / 14 ms | 3 / 9 ms |
| Accept → Trip `ASSIGNED` | 1,00 / 1,04 giây | 0,3 / 0,3 giây | 3,98 / 7,03 giây | 0,3 / 0,3 giây | 0,2 / 0,3 giây |
| Tổng `SEARCHING` → `ASSIGNED` | 2,91 / 3,88 giây | 0,6 / 0,8 giây | 30,8 / 78,9 giây | 0,5 / 0,7 giây | 0,5 / 0,8 giây |

Các đoạn trước đây chờ nhịp 1 giây (publish, accept → `ASSIGNED`) nay chỉ còn vài chục đến vài trăm ms. Khi quá tải (8 chuyến/giây trở lên), thời gian dồn vào đoạn `SEARCHING` → offer, tức bước tìm và kiểm tra tài xế ([mục 7.1](#71-driver-api-kiểm-tra-từng-tài-xế-một)).

### 6.4 Tăng quy mô số tài xế

Loạt 3, đo giống app, 4 chuyến/giây, 3 phút:

| Tài xế online | Lên mạng | GPS được ack | p50 / p95 tới `ASSIGNED` | Ack GPS p95 / max | CPU PostgreSQL / driver-api / Realtime | RAM edge / Realtime | Đạt? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1000 | 1000/1000 | 22178/22178 | 0,6 / 0,9 giây | 2 / 394 ms | 226 / 164 / 75 m | 58 / 155 MiB | **Đạt** |
| 2000 | 2000/2000 | 44288/44288 | 0,7 / 1,7 giây | 8 / 632 ms | 410 / 339 / 150 m | 87 / 184 MiB | **Đạt** |
| 3000 | 3000/3000 | 66399/66399 | 0,6 / 1,0 giây | 2 / 146 ms | 362 / 320 / 130 m | 118 / 212 MiB | **Đạt** |
| 5000 | 5000/5000 | 110458/110458 | 0,8 / 1,3 giây | 6 / 268 ms | 616 / 575 / 205 m | 183 / 281 MiB | **Đạt** |

So với mốc ban đầu:
- Trước đây, 2000 tài xế ở 2 chuyến/giây đã có 10% chuyến chờ tới 5,7 phút. 3000 tài xế ack GPS p95 1,6 giây. Từ khoảng 3500 kết nối, `cri-dockerd` sập và node chuyển `NotReady`. 5000 tài xế không đạt được trạng thái ổn định.
- Nay cả 5000 tài xế lên mạng, không lỗi và không rớt kết nối; mọi chuyến đều được gán trong khoảng 1,3 giây.

Nguyên nhân chính là bộ đo chạy trong cụm (E1), không còn qua port-forward, cùng với edge được cấu hình theo số tài xế (A9). RAM edge thực tế ở 5000 tài xế là 183 MiB, dưới giới hạn 448 MiB mà công thức A9 cấp.

Chi phí tăng gần tuyến tính theo số tài xế: từ 1000 lên 5000 tài xế, CPU PostgreSQL tăng khoảng 2,7 lần và CPU driver-api khoảng 3,5 lần ở cùng 4 chuyến/giây. Đây là hệ quả của việc kiểm tra điều kiện từng tài xế trong bán kính 2 km ([mục 7.1](#71-driver-api-kiểm-tra-từng-tài-xế-một)).

### 6.5 Chạy lâu 30 phút

Loạt 4: 1000 tài xế, 3 chuyến/giây, 30 phút, khách đăng nhập lại mỗi 10 phút, đo giống app.

| Chỉ số | Kết quả |
| --- | --- |
| Chuyến | 5395 tạo, 5388 được gán; lỗi HTTP 0% |
| Tới `ASSIGNED` | p50 0,7 giây, p95 3,1 giây (cả lần chạy) |
| p95 theo phút | 0,69–0,81 giây ở 26/30 phút; một đợt chậm 15:15–15:18 với p95 6–41 giây, sau đó tự hồi phục |
| GPS | 183978/184024 được ack, 46 lần quá thời gian; ack p95 36 ms, max 6,3 giây |
| Kết nối lại | 2000 lần, đúng bằng hai đợt JWT hết hạn của 1000 tài xế; không tài xế nào lỗi |
| RAM đầu → cuối | driver-api 126 → 126 MiB, Realtime 262 → 261, Gateway 495 → 500, Trip 109 → 113, matching-worker 80 → 80, PostgreSQL 493 → 511 MiB |
| Dọn outbox (A6) | Lần chạy đầu sau khi triển khai xoá 75508 tin outbox Trip cũ hơn 24 giờ và các tin cũ của Matching; câu claim của publisher Matching dùng index, 0,017 ms |

Không thấy RAM tăng dần hay độ trễ tăng theo thời gian. Đợt chậm 15:15–15:18 được phân tích ở [mục 7.4](#74-đợt-chậm-khi-chạy-lâu).

### 6.6 Đăng nhập và rate limit theo IP

| Kiểm tra | Kết quả |
| --- | --- |
| Khách đăng nhập 5 → 10 → 15 lượt/giây, mỗi mức 1 phút | 1924 lượt, 0 lỗi, 0 lần bị chặn; p50 60 ms, p95 77 ms, max 176 ms |
| CPU User service | Trung bình 0,58 core, cao nhất 0,86 core (BCrypt khoảng 60 ms mỗi lượt): một replica phục vụ khoảng 15–20 lượt/giây |
| A4: client giả `X-Forwarded-For` | 12 yêu cầu OTP tài xế từ một IP, mỗi lần giả một IP khác: 10 lần đầu 200, lần 11–12 bị 429. Header giả bị edge ghi đè |
| A4: IP khác nhau có quota riêng | Ngay sau đó, yêu cầu từ một pod khác trong cụm vẫn được 200. Trước A4, Driver chỉ thấy IP của Gateway nên cả hệ thống dùng chung 10 lượt/phút |

### 6.7 Kịch bản cao nhất đạt được

**Khoảng 1000 tài xế online với 6 chuyến/giây (khoảng 21600 chuyến/giờ)**, đạt ngưỡng ở cả hai cách đo: p95 tới `ASSIGNED` 1,0 giây, báo giá p95 25–66 ms, ack GPS p95 3–20 ms, lỗi 0%.

Ở 4 chuyến/giây, hệ thống đạt ngưỡng với tới **5000 tài xế online**. Mốc ban đầu chỉ là 1000 tài xế với 2 chuyến/giây.

## 7. Phân tích điểm nghẽn hiện tại

### 7.1 driver-api kiểm tra từng tài xế một

Từ 8 chuyến/giây, worker Matching phải thử lại hơn 1000 lần mỗi phút. Nhờ A7, log cho biết gần như tất cả là `ROUTING_BUSY` (2459/2463 lần trong 25 phút của loạt 2). Chuỗi nguyên nhân:
1. Mỗi lần tìm, Routing hỏi Realtime các tài xế trong 2 km. Realtime gọi Driver kiểm tra điều kiện của từng tài xế: đọc hồ sơ, đọc xe, lấy và trả advisory lock, hỏi Trip tài xế có đang chở chuyến nào không.
2. Ở 8 chuyến/giây, CPU cao nhất của driver-api vượt 1 core (1137–1185 millicore ở cả ba lần đo); ở 6 chuyến/giây chỉ 349 millicore. Một process Node chỉ chạy JavaScript trên một luồng.
3. Realtime trả lời chậm, nên việc trong hàng đợi của Routing chờ quá `ROUTING_JOB_MAX_WAIT_MS` (500 ms) và bị trả `ROUTING_BUSY`.

**Kiểm chứng:** đo lại 8 chuyến/giây với Routing 8 worker thay vì 2 cho kết quả không tốt hơn (3,95 chuyến/giây được gán, so với 3,2–4,4 ở 2 worker). Vậy giới hạn không nằm ở Routing mà ở driver-api phía sau.

Số lần kiểm tra cho thấy quy mô vấn đề. Ở loạt 2, 12 chuyến/giây, trong 2,5 phút có khoảng 363000 lần đọc hồ sơ tài xế, 363000 lần đọc xe, 362000 lần hỏi chuyến đang chở và 727000 lệnh lock/unlock. Tức khoảng 200 tài xế được kiểm tra cho mỗi lần tìm, trong khi Matching chỉ cần vài người gần nhất.

Hướng xử lý: B1 ([ADR-0001](adr/0001-matching-so-huu-tim-ung-vien.md)) và B4 trong [đề xuất](de-xuat-cai-tien-hieu-nang.md).

### 7.2 PostgreSQL bận vì số câu lệnh

| Lần đo | CPU PostgreSQL trung bình | Câu lệnh trong cửa sổ đo | Tổng thời gian thực thi |
| --- | --- | --- | --- |
| Loạt 1, 8 chuyến/giây (poll) | 1004 m | khoảng 1,1 triệu trong 2,5 phút | 25,7 giây |
| Loạt 2, 12 chuyến/giây (giống app) | 1053 m | khoảng 2,1 triệu trong 2,5 phút (khoảng 14000/giây) | 14,6 giây |
| Loạt 3, 5000 tài xế, 4 chuyến/giây | 616 m | khoảng 2,2 triệu trong 3 phút | 10,3 giây |

Thời gian thực thi cộng lại chỉ khoảng 0,1–0,17 core; phần lớn CPU là chi phí cố định của mỗi câu lệnh (nhận, phân tích, gửi kết quả, commit). Không có câu lệnh nào chậm: các câu nhiều nhất mất 0,001–0,07 ms. Giảm CPU PostgreSQL vì vậy là giảm số câu lệnh, chủ yếu là giảm số lần kiểm tra tài xế ([mục 7.1](#71-driver-api-kiểm-tra-từng-tài-xế-một)). Thêm index hay tăng tài nguyên PostgreSQL không giúp được nhiều.

Câu tốn nhất theo từng cách đo:

| Cách đo | Câu lệnh | Số lần | Tổng thời gian |
| --- | --- | --- | --- |
| Poll (loạt 1, 8/giây) | Trip đọc lịch sử trạng thái chuyến cho `GET /trips/:id` | 34489 | 2463 ms |
| Poll (loạt 1, 8/giây) | Driver đọc hồ sơ tài xế | 142299 | 1946 ms |
| Giống app (loạt 2, 12/giây) | Driver đọc hồ sơ tài xế | 363571 | 2041 ms |
| Giống app (loạt 2, 12/giây) | Driver đọc xe | 363690 | 1984 ms |
| Giống app (loạt 2, 12/giây) | Trip kiểm tra tài xế có chuyến đang mở | 362271 | 751 ms |

### 7.3 Poll khuếch đại tải khi khách chờ lâu

Ở cùng 8 chuyến/giây, khi hệ thống chậm và khách chờ lâu:

| | Poll (loạt 1) | `/ws` (loạt 2) |
| --- | --- | --- |
| Request HTTP trong 2 phút | 37372 | 3244 |
| CPU Gateway / Trip | 603 / 534 m | 76 / 145 m |
| Báo giá p95 | 833 ms | 159 ms |
| Ack GPS p95 | 161 ms | 3 ms |

App thật dùng `/ws`, nên tải đọc trạng thái trong thực tế nhẹ hơn nhiều so với bộ đo cũ. Bộ đo mới mặc định đo giống app.

### 7.4 Đợt chậm khi chạy lâu

Trong loạt 4, từ 15:15 tới 15:18, Routing gọi Realtime bị lỗi `REALTIME_UNAVAILABLE` và `REALTIME_DEADLINE_EXCEEDED`: 82 lỗi trong 4 phút, trong khi các phút 15:05–15:14 không có lỗi nào. Cùng lúc đó, ack GPS có lúc tới 6,3 giây.

- **Đã loại trừ:**
  - Redis: snapshot và ghi lại AOF đều chạy nền, mỗi lần dưới 1,5 giây, và cũng diễn ra ở các phút không chậm.
  - Job dọn outbox: không có lần dọn nào trong khoảng đó.
  - Pod khởi động lại: không có.
- **Trùng thời điểm:** đợt chậm bắt đầu ngay sau lượt thứ hai bộ giả lập làm mới token cho cả 1000 tài xế cùng lúc (mỗi 10 phút, 5 tài xế song song). Lượt đầu lúc 15:04 không gây chậm, nên chưa đủ để kết luận.
- **Chưa có:** metrics phía server (event loop lag của driver-api và Realtime) để xác định nguyên nhân. Đây là lý do cần B6 (observability) trước lần đo tiếp theo.

App thật nên làm mới token có jitter (B5), để tài xế đăng nhập cùng giờ không làm mới cùng lúc.

### 7.5 Kịch bản 3000 khách và 3500 tài xế

Kịch bản đợt (3000 khách đặt trong 1–2 phút, 3500 tài xế rảnh) chưa được chạy lại. Ước tính từ thông lượng đo được:

| Trạng thái | Thông lượng gán | Gán hết 3000 chuyến |
| --- | --- | --- |
| Mốc ban đầu | khoảng 2,5–3 chuyến/giây | 15–20 phút |
| Sau nhóm A | khoảng 6 chuyến/giây trong ngưỡng, tối đa khoảng 10 chuyến/giây | khoảng 5–8 phút |
| Mục tiêu 2 phút | khoảng 25 chuyến/giây | Cần B1, B4 và nhiều máy |

Với 3500 tài xế online, môi trường đo nay đã chạy được (loạt 3 đạt 5000 tài xế). Lần đo tiếp theo nên chạy trọn kịch bản này bằng `run.cjs --trips 3000 --in-cluster 1`.

## 8. Kết luận

1. **Nhóm A đạt và vượt mục tiêu đề xuất cho bước đầu** ("đạt ngưỡng ở khoảng 4–5 chuyến/giây"): mức đạt ngưỡng tăng từ 2 lên 6 chuyến/giây, thông lượng gán tối đa từ khoảng 3 lên khoảng 10 chuyến/giây, khi rảnh tới `ASSIGNED` khoảng 0,6 giây thay vì 3 giây.
2. **Hàng đợi không còn là điểm nghẽn**: offer được publish trong vài chục ms, Trip ghi `ASSIGNED` khoảng 0,3 giây sau khi tài xế nhận.
3. **Môi trường đo đã đủ cho quy mô demo**: 5000 tài xế online, chạy 30 phút ổn định, có số liệu SQL và mã lỗi để tìm nguyên nhân.
4. **Điểm nghẽn tiếp theo đã được định lượng**:
   - Kiểm tra từng tài xế ở driver-api (khoảng 200 tài xế mỗi lần tìm).
   - Số câu lệnh PostgreSQL (khoảng 14000/giây ở 12 chuyến/giây).

   Hai điểm này cần B1 (ADR-0001) và B4 chứ không cần thêm tài nguyên.
5. Ba điểm còn mở: sự không đơn điệu của thông lượng ở 8–10 chuyến/giây, đợt chậm 3 phút khi chạy lâu, và kịch bản 3000 khách chưa đo trọn.

## 9. Giới hạn của lần đo

- Một node local, một replica mỗi service; bộ tạo tải chạy chung máy (pod `load-runner` dùng 0,05–0,12 core). Không suy ra năng lực production.
- Chưa có metrics phía server (event loop lag, thời gian chờ trong pool Routing, HikariCP). Nguyên nhân tìm bằng CPU cgroup, `pg_stat_statements`, mốc thời gian trong DB và log có mã lỗi.
- Mỗi mức tải đo một lần, 2–3 phút; riêng 8 chuyến/giây đo ba lần. Thông lượng ở 8–10 chuyến/giây thấp hơn ở 12–16 chuyến/giây ở cả các lần đo lặp lại; chưa tìm ra vì sao, có thể liên quan tới nhịp thử lại đồng loạt sau `ROUTING_BUSY`.
- k6 không kịp khởi tạo VU cho 72–288 lượt đặt chuyến ở 8–16 chuyến/giây (`dropped_iterations`); số chuyến thực tế vì vậy thấp hơn mức đặt.
- Tài xế giả lập nhận offer ngay; khách không từ chối hay đổi ý. GPS và đăng nhập đều đến từ vài IP trong cụm.
- Số "mốc ban đầu" lấy từ lần đo 2026-10-28/29 (bản báo cáo ở commit `bc1db9b`), trên cùng máy, cùng kịch bản và cùng cách đo với loạt 1.

## 10. Phụ lục: chạy lại

```bash
node deploy/run.cjs build
node deploy/run.cjs kube-up
docker build -t chande-load:local deploy/load
node deploy/load/accounts.cjs seed --drivers 5000 --riders 3000
```

```bash
node deploy/load/run.cjs --drivers 1000 --radius 6000 --rate 6 --duration 2m --warmup 30 --gps-ms 3000 --events poll
node deploy/load/run.cjs --drivers 1000 --radius 6000 --rate 6 --duration 2m --warmup 30 --in-cluster 1 --events ws
node deploy/load/run.cjs --drivers 5000 --radius 6000 --ramp 25 --rate 4 --duration 3m --warmup 30 --in-cluster 1 --events ws
node deploy/load/run.cjs --drivers 1000 --radius 6000 --rate 3 --duration 30m --warmup 30 --in-cluster 1 --events ws --login 1
k6 run -e STAGES=5,10,15 -e STAGE=1m deploy/load/login.js
```

Mỗi lần đo ghi `summary.json`, `k6.json`, `segments.json`, `sql.json`, `pods.json` và `drivers.json` vào `deploy/.local/load/results/<thời điểm>/` (không commit). Danh sách 18 lần đo trong báo cáo này nằm ở `deploy/.local/load/campaign/index.tsv` trên máy đo.

## 11. Đo lại sau B7 và ADR-0001 (2026-11-05)

Mã nguồn: nhánh `perf/adr-0008-trip-outbox`, commit `d8ff195`, gồm B7 (kiểm tra tài xế theo lô ở Driver và Trip) và ADR-0001 bước expand + migrate (Matching tự lấy 200 vị trí, kiểm theo lô, tính ETA cho 25 người gần nhất; [đề xuất, mục 3.1](de-xuat-cai-tien-hieu-nang.md#31-đã-triển-khai-chưa-đo-2026-11-05)). Cùng máy, cùng tham số và cùng lệnh với các lần đo ngày 2026-11-04; mỗi mức đo một lần, riêng loạt 1 ở 6 chuyến/giây đo hai lần. "Trước" là lần đo 2026-11-04 cùng tham số.

### 11.1 Thông lượng, cách đo giống app

1000 tài xế, 2 phút mỗi mức. "Được gán" là số chuyến tới `ASSIGNED` trên số lượt đặt (gồm lượt k6 không kịp chạy).

| Đặt chuyến/giây | Được gán (trước → sau) | p95 tới `ASSIGNED` | Báo giá p95 | Tổng câu SQL | CPU driver-api TB / max | CPU PostgreSQL TB / max | Đạt (trước → sau) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 4 | 481/481 → 481/481 | 0,9 → 0,8 giây | 13 → 21 ms | 368577 → 98412 | 134 / 151 → 44 / 81 m | 188 / 222 → 125 / 176 m | Đạt → Đạt |
| 6 | 721/721 → 720/720 | 1,0 → 0,9 giây | 25 → 25 ms | 553991 → 142919 | 213 / 349 → 65 / 81 m | 329 / 510 → 170 / 222 m | Đạt → Đạt |
| 8 | 482/805 → **961/961** | 41,3 → **0,9 giây** | 159 → 18 ms | 1735765 → 189251 | 598 / 1141 → 58 / 86 m | 741 / 1308 → 174 / 275 m | Không → **Đạt** |
| 10 | 575/1005 → **1201/1201** | 47,7 → **0,9 giây** | 132 → 18 ms | 2032798 → 231806 | 661 / 1184 → 63 / 86 m | 831 / 1439 → 212 / 260 m | Không → **Đạt** |
| 12 | 1305/1441 → **1441/1441** | 50,0 → **0,9 giây** | 74 → 22 ms | 2114438 → 276744 | 817 / 1185 → 73 / 115 m | 1053 / 1591 → 268 / 476 m | Không → **Đạt** |
| 16 | 1540/1920 → 1909/1921 | 53,3 → 30,3 giây | 69 → 238 ms | 2205105 → 439698 | 926 / 1177 → 172 / 765 m | 1224 / 1582 → 352 / 598 m | Không → Không |

Ack GPS p95 3 ms và lỗi HTTP 0% ở mọi mức. Hiện tượng "8–10 chuyến/giây kém hơn 12–16" ([mục 9](#9-giới-hạn-của-lần-đo)) không còn: thông lượng nay tăng đơn điệu theo tải.

### 11.2 Tăng mật độ tài xế

| Tài xế, đặt chuyến/giây | Được gán | p95 tới `ASSIGNED` (trước → sau) | Ack GPS p95 | Tổng câu SQL (trước → sau) | CPU driver-api TB | CPU Realtime TB / max | Đạt |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2000, 4 | 721/721 | 1,7 → 0,9 giây | 8 → 3 ms | 965250 → 145916 | 339 → 49 m | 107 / 187 m | Đạt |
| 5000, 4 | 721/721 | 1,3 → 1,0 giây | 6 → 26 ms | 2234134 → 146141 | 575 → 125 m | 209 / 539 m | Đạt |
| 5000, 8 (mới) | 947/960 | — → 12,4 giây | — → 1449 ms | — → 185756 | 159 m | 418 / 817 m | Không |

Ở 4 chuyến/giây, tổng câu SQL không còn tăng theo số tài xế (146 nghìn ở cả 2000 lẫn 5000, trước là 0,97 triệu và 2,2 triệu): mỗi lần tìm chỉ xét tối đa 200 vị trí và 25 ETA, đúng mục tiêu của ADR-0001.

### 11.3 Cách đo như mốc ban đầu

1000 tài xế, GPS 3 giây, khách poll 300 ms, qua `kubectl port-forward`.

| Đặt chuyến/giây | Được gán (trước → sau) | p95 tới `ASSIGNED` | Báo giá p95 | Ack GPS p95 | Lỗi HTTP | Đạt (trước → sau) |
| --- | --- | --- | --- | --- | --- | --- |
| 6 (hai lần) | 720/720 → 721/721; 720/720 | 1,0 → 1,4; 1,6 giây | 66 → 325; 242 ms | 20 → 390; 246 ms | 0% | Đạt → Không (ack GPS) |
| 8 | 961/961 → 961/961 | 37,4 → 1,6 giây | 833 → 423 ms | 161 → 243 ms | 0% | Không → Không (báo giá, GPS) |
| 10 | 437/1054 → 1200/1200 | 51,9 → 4,4 giây | 1250 → 717 ms | 417 → 551 ms | 7,86% → 0% | Không → Không (báo giá, GPS) |

Thời gian tới `ASSIGNED` tốt lên rõ ở 8 và 10 chuyến/giây, nhưng ở cách đo này báo giá và ack GPS p95 ở 6 chuyến/giây xấu hơn lần đo trước, lặp lại ở lần đo thứ hai. Cùng mức tải, cách đo trong cụm cho báo giá 25 ms và ack GPS 3 ms, và không pod nào vượt 0,4 core; giá trị lớn nhất gần như không đổi (GPS 2025 so với 2077 ms). Phần chậm vì vậy nằm trên đường qua `kubectl port-forward` hoặc máy host chứ chưa thấy ở service, nhưng chưa xác định được nguyên nhân.

### 11.4 Điểm nghẽn mới

- **16 chuyến/giây: Routing.** Worker Matching thử lại 5243 lần vì `ROUTING_BUSY`, toàn bộ trong hai phút của lần đo này; không lần đo nào khác quá 20 lần. Giới hạn tốc độ Routing đặt cho OSRM ở A8 lại thành trần. driver-api và PostgreSQL vẫn dưới 0,4 core trung bình.
- **5000 tài xế ở 8 chuyến/giây: Realtime và đường GPS.** 2697 bản tin GPS hết thời gian chờ ack, đoạn tìm tới tạo offer p95 8,0 giây, báo giá p95 1,4 giây; Realtime 0,42 core trung bình, 0,82 core đỉnh, giữ 5000 kết nối Socket.IO trên một process. Không có `ROUTING_BUSY`; PostgreSQL 0,47 core, driver-api 0,16 core. Tổng CPU các pod trung bình 2,7 core trên 10 core của VM. Cần số đo bên trong process (B6) để xác nhận.
- Lần đo đầu tiên sau khi khởi động lại cụm có báo giá p95 424 ms và ack GPS 155 ms (JVM Gateway và cache PostgreSQL còn nguội); các lần sau về 18–25 ms và 3 ms. Bảng trên dùng lần đo trong loạt chính, không dùng lần đầu này.

### 11.5 Kết luận

1. B7 và ADR-0001 xử lý đúng điểm nghẽn ở [mục 7.1](#71-driver-api-kiểm-tra-từng-tài-xế-một) và [7.2](#72-postgresql-bận-vì-số-câu-lệnh): câu SQL giảm 73–93% tuỳ mức, CPU driver-api ở 12 chuyến/giây từ 0,82 xuống 0,07 core, PostgreSQL từ 1,05 xuống 0,27 core.
2. Mức đạt ngưỡng ở cách đo giống app tăng từ 6 lên 12 chuyến/giây; ước tính 10–12 chuyến/giây của đề xuất là đúng.
3. Bước tiếp theo theo số đo: B6 (metrics bên trong process) để xác nhận trần ở Realtime; xem lại giới hạn Routing cho OSRM tự host (A8) nếu muốn vượt 12–16 chuyến/giây; điều tra ack GPS qua port-forward ở cách đo cũ.

Lệnh đo: [mục 10](#10-phụ-lục-chạy-lại), thêm `--drivers 5000 --ramp 25 --rate 8 --duration 2m` cho dòng mới. Danh sách 13 lần đo nằm trong `index.tsv` của lần chạy trên máy đo; kết quả ở `deploy/.local/load/results/2026-11-05T*`.

## 12. Đo lại với observability (2026-11-10)

Mã nguồn: nhánh `perf/adr-0008-trip-outbox`, commit `06bfc2b` cộng thay đổi giới hạn trace của Jaeger ở [mục 12.2](#122-chi-phí-của-observability). So với [mục 11](#11-đo-lại-sau-b7-và-adr-0001-2026-11-05) có thêm: bước contract của ADR-0001, sửa deploy `720fa49`, và observability cho sáu service Node ([ADR-0003](adr/0003-observability-opentelemetry.md)). Cùng máy, cùng cách đo giống app (trong cụm, `/ws`, GPS 10 giây), 1000 tài xế, 2 phút mỗi mức, mỗi mức một lần trừ khi ghi khác. Giới hạn Routing để mặc định.

### 12.1 Thông lượng khi tắt observability

| Đặt chuyến/giây | Được gán | p95 tới `ASSIGNED` | Báo giá p95 | Ack GPS p95 | Tổng câu SQL | CPU PostgreSQL TB / max | CPU matching-worker TB / max | CPU trip-api TB / max | Đạt |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 6 | 721/721 | 0,9 giây | 21 ms | 3 ms | 142345 | 165 / 183 m | 83 / 102 m | 73 / 81 m | Đạt |
| 16 | 1920/1920 | 1,0 giây | 34 ms | 4 ms | 366283 | 369 / 464 m | 165 / 214 m | 152 / 228 m | Đạt |
| 20 | 2401/2401 | 1,0 giây | 23 ms | 4 ms | 455179 | 369 / 432 m | 168 / 219 m | 162 / 207 m | Đạt |
| 24 | 2881/2881 | 1,0 giây | 19 ms | 3 ms | 544719 | 442 / 533 m | 195 / 208 m | 185 / 192 m | Đạt |
| 28 | 3361/3361 | 1,0 giây | 23 ms | 4 ms | 632175 | 525 / 638 m | 222 / 259 m | 217 / 234 m | Đạt |
| 32 | **3841/3841** | **1,1 giây** | 47 ms | 5 ms | 718626 | 625 / 753 m | 258 / 307 m | 248 / 278 m | **Đạt** |

Lỗi HTTP 0% ở mọi mức. Log của matching-worker không có lần thử lại nào vì `ROUTING_BUSY` ở 24, 28 và 32 chuyến/giây. Ở 32 chuyến/giây chưa có dấu hiệu bão hoà: p95 gần như không đổi so với 6 chuyến/giây, PostgreSQL 0,63 core, không service nào quá 0,31 core trung bình. Chưa đo cao hơn nên **chưa biết trần**; 32 chuyến/giây là mức cao nhất đã chứng minh, không phải giới hạn.

### 12.2 Chi phí của observability

Bật bằng `OBSERVABILITY=on`, tỉ lệ lấy mẫu trace 0,1. "CPU Node" là tổng CPU trung bình của tám pod Node (trip-api, trip-worker, matching-api, matching-worker, driver-api, realtime-api, routing-api, price-api).

| Đặt chuyến/giây | Tắt: p95, CPU Node | Bật, Jaeger 10000 trace: p95, CPU Node, Jaeger | Bật, Jaeger 4000 trace: p95, CPU Node, Jaeger |
| --- | --- | --- | --- |
| 6 | 0,9 giây; 435 m | 0,9 giây; 533 m; 7 m, 159 MiB | 0,9 giây; 525 m; 6 m, 195 MiB |
| 16 (hai lần khi bật) | 1,0 giây; 804 m | 2,0 và 1,5 giây; 1635 và 1205 m; 33 và 172 m, tới 421 MiB | Không đo |
| 20 | 1,0 giây; 820 m | 8,5 giây, báo giá p95 801 ms (**không đạt**); 2329 m; 457 m, 511 MiB | **1,1 giây**, báo giá 50 ms; 1076 m; 12 m, 384 MiB |
| 24 | 1,0 giây; 933 m | 285 chuyến không được gán (**không đạt**); 2412 m; 277 m, 509 MiB | **1,3 giây**, 2881/2881, báo giá 78 ms; 1392 m; 16 m, 417 MiB |

- Jaeger lưu trace trong RAM với giới hạn 512 MiB. Khi chạm giới hạn, nó dùng tới 0,5–1,5 core để thu gom bộ nhớ và làm chậm cả cụm: với 50000 trace (cấu hình đầu tiên) Jaeger mất ready ở 16 chuyến/giây; với 10000 trace hệ thống trượt ngưỡng ở 20 chuyến/giây. Với 4000 trace và `GOMEMLIMIT=400MiB` (cấu hình hiện tại), 24 chuyến/giây đạt và Jaeger dùng 0,02 core.
- Phần chi phí còn lại nằm trong chính các process Node: CPU tăng khoảng 20% ở 6 chuyến/giây, 31% ở 20 và 49% ở 24 chuyến/giây (1392 so với 933 m). p95 tới `ASSIGNED` tăng từ 1,0 lên 1,1–1,3 giây.
- Prometheus dùng dưới 0,01 core và khoảng 140 MiB; Grafana khoảng 240 MiB. Collector không có shell nên bộ đo không lấy được số CPU của nó.
- Kết luận về cách dùng: bật observability để tìm nguyên nhân, tắt khi đo trần thông lượng. Chưa đo trên 24 chuyến/giây khi bật.

### 12.3 5000 tài xế

| Tài xế, đặt chuyến/giây | Được gán (2026-11-05 → nay) | p95 tới `ASSIGNED` | Ack GPS p95 | Bản tin GPS gửi / được ack | CPU Realtime TB / max | Đạt |
| --- | --- | --- | --- | --- | --- | --- |
| 5000, 8 (bật observability, `--ramp 25`) | 947/960 → **961/961** | 12,4 → **0,9 giây** | 1449 → **5 ms** | 80627 / 80627 | 418 / 817 → 206 / 266 m | Không → **Đạt** |

Số đo trong process của lần này: Realtime giữ 5000 socket, xử lý một bản tin GPS p95 1,9 ms, event loop bận tối đa 29%, độ trễ event loop p99 43 ms; process bận nhất là driver-api (event loop 49%). Lần không đạt ngày 2026-11-05 không lặp lại và hôm đó chưa có số đo trong process, nên **nguyên nhân của lần đó chưa xác định**; bước contract của ADR-0001 đã bỏ đường `/nearby-drivers` khỏi Realtime giữa hai lần đo, nhưng chưa có phép đo nào tách riêng tác động này.

### 12.4 Vì sao 16 chuyến/giây từng không đạt

Ngày 2026-11-05, 16 chuyến/giây có 5243 lần thử lại vì `ROUTING_BUSY` ([mục 11.4](#114-điểm-nghẽn-mới)). Hôm nay không có lần nào tới 32 chuyến/giây, dù code giới hạn của Routing không đổi. Giải thích khớp với số liệu:

1. Trước A8, [stack.cjs](../deploy/stack.cjs) đặt cứng `RATE_LIMIT_REQUESTS_PER_SECOND=50` và `RATE_LIMIT_MATRIX_ELEMENTS_PER_MINUTE=20000`. A8 (`36b8643`) bỏ hai dòng này để dùng mặc định mới cho OSRM tự host.
2. `kubectl apply` không xoá được khoá đã bỏ khỏi `stringData` của Secret, nên pod Routing vẫn chạy với hai giá trị cũ.
3. Mỗi lần tìm xe tính ETA cho 25 tài xế: 12 chuyến/giây là 18000 phần tử/phút (dưới 20000, đạt), 16 chuyến/giây là 24000 (vượt, bị từ chối). Đúng với ranh giới đã đo.
4. Commit `720fa49` cho `kube-up` thay hẳn Secret; từ đó giới hạn của A8 mới có hiệu lực.

Đây là suy luận từ lịch sử code và phép tính, chưa tái hiện bằng cách đặt lại giới hạn cũ. Hệ quả: không cần nới giới hạn Routing; `routingLimits` trong stack.cjs để trống. Nếu cần thử, các biến giới hạn và `OSRM_THREADS` đặt được khi deploy ([deploy backend](deploy-backend.md#build-và-startup)).

### 12.5 Dashboard cho thấy gì khi quá tải

Lấy từ Prometheus trong lần 24 chuyến/giây bị quá tải (Jaeger 10000 trace), là ví dụ về câu hỏi mà trước đây không trả lời được:

| Câu hỏi | Số đo |
| --- | --- |
| Routing có từ chối không? | Không: `routing_failures` lý do `ROUTING_BUSY` bằng 0; chờ worker pool p95 114 ms, hàng chờ tối đa 6 |
| Bước tìm xe nào chậm? | Lấy vị trí từ Realtime p95 1017 ms; ETA 238 ms; kiểm điều kiện 154 ms; loại trừ 94 ms |
| Process nào hết event loop? | matching-worker bận 87%, Realtime 82% (độ trễ p99 534 ms), trip-api 77% |
| Hàng đợi nào dồn? | Outbox Trip trễ p95 4,4–4,6 giây ở cả ba đích; outbox offer của Matching trễ trên 10 giây |

Khi không quá tải (16 chuyến/giây): các bước tìm xe p95 9–45 ms, độ trễ event loop p99 dưới 30 ms, hàng chờ Routing bằng 0.

### 12.6 Kết luận và giới hạn

1. Mức đã chứng minh đạt ngưỡng tăng từ 12 lên 32 chuyến/giây (tắt observability) và 24 chuyến/giây (bật). Mốc ban đầu là 2 chuyến/giây trên cùng máy, nhưng đo bằng cách đo cũ (qua port-forward, GPS 3 giây) nên hai con số không so trực tiếp được; phép so cùng cách đo là 6 chuyến/giây ngày 2026-11-04.
2. Observability trả lời được câu hỏi "chậm ở đâu", có chi phí CPU 20–50% ở các service Node, và Jaeger phải được giới hạn bộ nhớ đúng.
3. A8 không cần chỉnh thêm; vấn đề là giới hạn cũ còn sót khi deploy.
4. Giới hạn của lần đo: mỗi mức một lần, 2 phút, trên một MacBook nên sai số giữa các lần đáng kể (hai lần 16 chuyến/giây khi bật cho p95 2,0 và 1,5 giây); chưa đo trên 32 chuyến/giây; chưa đo lại chạy lâu 30 phút và cách đo qua port-forward; Gateway, User, Payment chưa có số đo trong process.

Lệnh đo: [mục 10](#10-phụ-lục-chạy-lại) với `--rate` tương ứng; bật observability theo [deploy backend](deploy-backend.md#observability-tuỳ-chọn). Danh sách 21 lần đo nằm trong `index.tsv` của lần chạy trên máy đo; kết quả ở `deploy/.local/load/results/2026-11-10T*`.


## 13. HTTP và gRPC giữa các service (2026-11-15)

> Ngày 2026-11-16 nhóm quyết định không chuyển sang gRPC ([ADR-0009](adr/0009-giao-tiep-noi-bo-grpc.md), không chấp nhận) và code gRPC đã được gỡ. Mục này giữ số đo làm căn cứ cho quyết định; các dòng HTTP vẫn là số đo của code hiện tại.

Mã nguồn: nhánh `perf/adr-0008-trip-outbox`, commit `f20eb1e`. So với [mục 12](#12-đo-lại-với-observability-2026-11-10) có thêm: circuit breaker và ngân sách thử lại (D1), Leader Election cho việc dọn outbox, Priority Queue cho worker Matching, và gRPC cho 11 luồng gọi giữa các service Node ([ADR-0009](adr/0009-giao-tiep-noi-bo-grpc.md)). Cùng code, cùng image; chỉ đổi `INTERNAL_TRANSPORT` khi `kube-up`. Cùng cách đo giống app (trong cụm, `/ws`, GPS 10 giây), 1000 tài xế, 2 phút mỗi mức, tắt observability. Thứ tự chạy: gRPC 8, 16, 32 → HTTP 8, 16, 32 → gRPC 32 lần hai.

| Giao thức | Đặt chuyến/giây | Được gán | p95 tới `ASSIGNED` | Báo giá p95 | Ack GPS p95 | Tổng câu SQL | CPU 8 pod Node TB | CPU PostgreSQL TB / max | CPU matching-worker TB / max | CPU trip-api TB / max | Đạt |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| HTTP | 8 | 960/960 | 0,89 giây | 21 ms | 3 ms | 188098 | 509 m | 189 / 230 m | 97 / 116 m | 92 / 109 m | Đạt |
| gRPC | 8 | 961/961 | 0,81 giây | 13 ms | 3 ms | 188113 | 401 m | 152 / 170 m | 70 / 96 m | 74 / 100 m | Đạt |
| HTTP | 16 | 1920/1920 | 0,86 giây | 17 ms | 3 ms | 363852 | 673 m | 304 / 339 m | 129 / 136 m | 139 / 152 m | Đạt |
| gRPC | 16 | 1920/1920 | 0,82 giây | 13 ms | 2 ms | 365307 | 624 m | 267 / 300 m | 118 / 128 m | 119 / 125 m | Đạt |
| HTTP | 32 | 3841/3841 | 1,31 giây | 45 ms | 6 ms | 719936 | 1355 m | 639 / 1015 m | 272 / 397 m | 284 / 422 m | Đạt |
| gRPC (lần 1) | 32 | 3835/3835, bỏ 5 lượt | 7,58 giây | 290 ms | 26 ms | 725535 | 1588 m | 721 / 1155 m | 297 / 480 m | 324 / 537 m | Đạt sát ngưỡng |
| gRPC (lần 2) | 32 | 3841/3841 | 1,06 giây | 25 ms | 3 ms | 720570 | 1131 m | 523 / 628 m | 211 / 256 m | 228 / 246 m | Đạt |

Lỗi HTTP 0% ở mọi lần. Nhận xét:

1. **Số câu SQL như nhau** ở hai giao thức: gRPC chỉ đổi cách chở dữ liệu giữa service, không đổi việc mỗi service làm.
2. **CPU giảm khi dùng gRPC**: tổng CPU tám pod Node thấp hơn 21% ở 8 chuyến/giây, 7% ở 16 và 17% ở 32 (lần hai). Mỗi client gRPC giữ một kết nối HTTP/2 lâu dài tới mỗi service đích và mã hoá protobuf, thay vì mở request HTTP/1.1 và parse JSON. Độ trễ p95 tương đương hoặc thấp hơn một chút; ở các mức này độ trễ chủ yếu nằm ở bước tìm xe và ghi DB, không ở đường truyền.
3. **Lần gRPC 32 đầu tiên chậm ở đoạn offer → publish** (p95 4,5 giây; đoạn này đi qua RabbitMQ, không qua gRPC), báo giá p95 290 ms, ack GPS p95 26 ms, PostgreSQL lên 1,16 core. Lần chạy lại ngay sau trên cùng code không lặp lại (p95 1,06 giây). Kiểu dao động này đã gặp ở [mục 12.6](#126-kết-luận-và-giới-hạn); với mỗi mức chỉ 1–2 lần đo, không đủ để nói gRPC nhanh hơn HTTP về độ trễ, chỉ đủ để nói **gRPC không chậm hơn và tốn ít CPU hơn**.
4. Mức 32 chuyến/giây vẫn đạt ngưỡng với cả hai giao thức sau D1, Leader Election và Priority Queue; các thay đổi này không làm giảm thông lượng đã có ở mục 12.

Kiểm chứng chức năng cùng ngày: smoke trên Kubernetes (một chuyến hoàn thành, một chuyến huỷ qua Gateway) qua ở cả `http` và `grpc`; ở chế độ `grpc`, đọc `/proc/net/tcp` trong pod cho thấy matching-worker giữ kết nối tới cổng 50051, 50053, 50054, 50055, trip-worker tới 50052, trip-api tới 50055, 50056 và realtime-api tới 50052.

Lệnh đo: [mục 10](#10-phụ-lục-chạy-lại) với `--rate` tương ứng; khi đo, giao thức được chọn bằng biến `INTERNAL_TRANSPORT` (đã gỡ). Kết quả ở `deploy/.local/load/results/2026-11-15T14*` và `2026-11-15T15-01-01-652Z`.

## 14. Tìm trần và quan sát Gateway (2026-11-17)

Mã nguồn: nhánh `perf/adr-0008-trip-outbox`, commit `d019fac` (giao tiếp nội bộ HTTP; thêm OpenTelemetry Java agent cho Gateway). Cùng cách đo giống app (trong cụm, `/ws`, GPS 10 giây), 1000 tài xế, 2 phút mỗi mức, mỗi mức một lần.

### 14.1 Trần thông lượng (tắt observability)

| Đặt chuyến/giây | Được gán | p95 tới `ASSIGNED` | Báo giá p95 | Ack GPS p95 | Tổng câu SQL | CPU PostgreSQL TB / max | CPU matching-worker TB / max | CPU gateway-api TB / max | Đạt |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 40 | 4801/4801 | 1,6 giây | 71 ms | 8 ms | 899439 | 762 / 930 m | 353 / 408 m | 535 / 1002 m | Đạt |
| 48 | 5761/5761 | 1,7 giây | 68 ms | 11 ms | 1084366 | 928 / 1143 m | 432 / 579 m | 527 / 673 m | Đạt |
| 64 | 5632/5696, bỏ 1984 lượt | 42,7 giây | 154 ms | 48 ms | 1189135 | 1266 / 1428 m | 656 / 818 m | 621 / 765 m | **Không đạt** |

Lỗi HTTP 0% ở cả ba mức. **Mức cao nhất đạt ngưỡng là 48 chuyến/giây.** Ở 64 chuyến/giây hệ thống chỉ gán được khoảng 45 chuyến/giây (5632 chuyến trong 125 giây), nên trần nằm quanh 45–50 chuyến/giây; chưa đo các mức giữa 48 và 64.

Ở 64 chuyến/giây, thời gian dồn vào hai đoạn của Matching: `SEARCHING` → tạo offer p95 36,7 giây và offer → publish p95 12,3 giây; hai đoạn sau (tài xế nhận, Trip ghi `ASSIGNED`) vẫn 49 ms và 301 ms. Log của matching-worker trong lúc đó không có lần thử lại nào vì dependency bận, Routing không từ chối, breaker không mở, và không pod nào chạm giới hạn CPU của nó (PostgreSQL 1,27 core, matching-worker 0,66 core trung bình).

Suy luận đầu tiên là Matching worker thiếu chỗ chạy đồng thời (pool job 16, pool kết nối 10). Thử nghiệm ở [mục 14.5](#145-thử-nghiệm-tìm-điểm-nghẽn-ở-64-chuyếngiây) **bác suy luận này**: điểm nghẽn là PostgreSQL ghi commit, không phải pool của Matching.

### 14.2 Gateway dưới tải (bật observability, 32 chuyến/giây)

Lần đo này: 3841/3841 chuyến, p95 2,3 giây (bật observability nên chậm hơn, xem [mục 12.2](#122-chi-phí-của-observability)). Số liệu của Gateway lấy từ Prometheus trong 2 phút bơm tải:

| Chỉ số | Giá trị |
| --- | --- |
| Request vào Gateway | 347/giây (trip-api và matching-api khoảng 200/giây mỗi service) |
| Trong đó `POST /internal/events/trips` từ Trip | 172/giây, gần một nửa |
| `/api/v1/trips/**` (báo giá, đặt, đọc, huỷ) | 117/giây, p95 95 ms; gần hết thời gian là chờ trip-api |
| CPU JVM | 0,53 core |
| GC (Serial: Copy + MarkSweepCompact) | khoảng 3% thời gian |
| Luồng | 15 runnable, 68 chờ |

Hai điều rút ra:

1. **Mỗi event của Trip tới Gateway hai lần.** Outbox của Trip có hai đích `gateway` và `notification`, cả hai đang trỏ về `gateway-api:8090`. Gộp hai đích (đề xuất B2, [ADR-0002](adr/0002-truc-su-kien-rabbitmq.md)) sẽ bỏ khoảng một phần tư số request vào Gateway và 3 trong 8 delivery outbox mỗi chuyến của Trip. Phần gộp đích đã làm ở commit `f0d424c`, kết quả ở [mục 14.6](#146-sau-b2-event-của-trip-tới-gateway-một-lần).
2. **Gateway chưa phải điểm nghẽn.** CPU tăng gần tuyến tính theo tải (0,34 core ở 32 chuyến/giây khi tắt observability, 0,53–0,62 ở 40–64) và còn xa giới hạn 2 core; GC không đáng kể. Nó vẫn là pod ứng dụng tốn CPU nhất vì mọi request đi qua nó.

### 14.3 Chạy liên tục 30 phút ở 16 chuyến/giây

Tắt observability, thêm `--login 1` để khách tự đăng nhập lại (token sống 15 phút). Lần chạy đầu thiếu tham số này nên nửa sau các lượt đặt không gọi được; kết quả đó bị bỏ, không tính.

| Chỉ số | Kết quả |
| --- | --- |
| Được gán | 28800/28800, lỗi HTTP 0%, không bỏ lượt nào |
| Tới `ASSIGNED` | p50 0,70 giây, p95 0,93 giây, p99 1,33 giây, max 15,6 giây |
| Theo từng phút | Mỗi phút đủ 960 chuyến; p95 0,71–0,86 giây ở 29 phút, một phút 1,40 giây |
| Ack GPS | 184088/184088, p95 4 ms |
| CPU trung bình | PostgreSQL 0,32 core, gateway-api 0,17, matching-worker 0,14, trip-api 0,14 |
| RAM đầu → cuối (MiB) | PostgreSQL 471 → 509, gateway-api 514 → 505, matching-worker 80 → 89, trip-worker 77 → 87, realtime-api 154 → 147, Redis 158 → 189 |

1. **Không còn đợt chậm 3 phút** như lần chạy 30 phút ngày 2026-11-04 ([mục 6.5](#65-chạy-lâu-30-phút)); khi đó hàng đợi còn nghỉ theo nhịp và tải chỉ 3 chuyến/giây.
2. **Có hai gợn ngắn dưới một phút** ở phút thứ 14 và 24 (29 và 33 trong 960 chuyến chờ quá 2 giây; phút kế tiếp p95 1,40 giây). Mỗi tài xế rớt kết nối đúng 2 lần trong 30 phút (2000 lần cho 1000 tài xế) vì Realtime ngắt socket khi JWT hết hạn, và 1000 tài xế đăng nhập cùng lúc nên nối lại cùng lúc. Thời điểm trùng nhau nhưng chưa đo riêng để khẳng định; app thật đăng nhập rải rác nên ít gặp hơn. Đề xuất B5 (làm mới token trước hạn, nối lại có jitter) nhắm đúng chỗ này.
3. Vài chuyến lẻ chờ 7–15 giây (khoảng một chuyến mỗi vài phút), chưa tìm nguyên nhân.
4. RAM các service ổn định; Redis tăng 31 MiB trong 30 phút, cần theo dõi ở lần chạy dài hơn.

### 14.4 Kết luận

1. Trần ngày 2026-11-16 khoảng 45–50 chuyến/giây; sau khi giảm ghi của Matching (mục 14.7) mức đã chứng minh đạt ngưỡng là **64 chuyến/giây**, trần nằm giữa 64 và 72.
2. Điểm nghẽn ở trần là PostgreSQL: ghi WAL khi commit trước, rồi tới giới hạn 2 core của nó ([mục 14.5](#145-thử-nghiệm-tìm-điểm-nghẽn-ở-64-chuyếngiây)). Nâng pool của Matching không giúp; mỗi chuyến đang tốn khoảng 190 câu SQL và 60 commit. Gộp đích outbox của Trip (B2) bớt việc ghi nhưng không nâng trần ([mục 14.6](#146-sau-b2-event-của-trip-tới-gateway-một-lần)): phần nghẽn nằm ở đường ghi của Matching.
3. Gateway chưa nghẽn, nhưng nhận gấp đôi số event cần thiết từ Trip (B2).
4. Hệ thống chạy ổn định 30 phút ở một phần ba mức trần.
5. Giới hạn: mỗi mức một lần, một laptop (PostgreSQL ghi xuống đĩa ảo của Docker Desktop, nên trần commit phụ thuộc máy đo); chưa đo giữa 48 và 64; User (Java) chưa có telemetry.

### 14.5 Thử nghiệm tìm điểm nghẽn ở 64 chuyến/giây

Cùng kịch bản 64 chuyến/giây, mỗi cấu hình một lần. Hai biến `WORKER_CONCURRENCY` (nay tối đa 64) và `DB_POOL_SIZE` của Matching đổi được khi deploy bằng `MATCHING_WORKER_CONCURRENCY`, `MATCHING_DB_POOL_SIZE`.

| Cấu hình | Được gán trong 2 phút | p95 tới `ASSIGNED` | `SEARCHING` → offer p95 | Offer → publish p95 | Commit/giây của PostgreSQL | CPU PostgreSQL TB / max |
| --- | --- | --- | --- | --- | --- | --- |
| Mặc định (16 job, 10 kết nối, 1 worker) | 5632 | 42,7 giây | 36,7 giây | 12,3 giây | 2827 | 1266 / 1428 m |
| 32 job, 20 kết nối, 1 worker | 4138 | 49,7 giây | 43,0 giây | 16,9 giây | 2472 | 1217 / 1305 m |
| Mặc định, 2 replica worker | 6106 | 40,2 giây | 36,1 giây | 1,7 giây | 2948 | 1452 / 1624 m |
| Mặc định, 2 replica worker (lặp lại, có lấy mẫu) | 5554 | 46,4 giây | 43,5 giây | 1,0 giây | 2807 | 1435 / 1565 m |
| 2 replica worker, `synchronous_commit=off` (chỉ để chẩn đoán) | 7181 | 17,7 giây | 15,2 giây | 0,6 giây | 3468 | 1481 / 1629 m |

Ở 48 chuyến/giây (đạt ngưỡng) PostgreSQL đã chạy 2878 commit/giây.

1. **Nâng pool của Matching làm tệ hơn** (4138 so với 5632 chuyến): thêm việc chạy đồng thời chỉ thêm tranh chấp ở database. Giữ mặc định 16 job, 10 kết nối.
2. **Hai replica worker** giải toả đoạn gửi offer (12,3 giây xuống 1–1,7 giây, vì publisher không còn chung một luồng với việc tìm xe) nhưng bước tìm xe vẫn dồn và tổng số chuyến gán gần như không đổi.
3. **Số commit mỗi giây đứng ở khoảng 2800–2950** dù tải, pool hay số replica thay đổi. Lấy mẫu `pg_stat_activity` mỗi giây trong lúc chạy: trong các phiên đang thực thi lệnh, khoảng một nửa đang chờ ghi WAL (`WALWrite`, `WalSync`, `WALInsert`).
4. **Tắt `synchronous_commit`** (PostgreSQL trả lời commit trước khi ghi WAL xuống đĩa) đưa commit lên 3468/giây và số chuyến gán lên 7181, p95 từ 46 xuống 17,7 giây, nhưng vẫn không đạt ngưỡng; lúc đó PostgreSQL dùng 1,5–1,6 core trên giới hạn 2 core. Cấu hình này làm mất các commit cuối khi PostgreSQL sập nên **không dùng cho dữ liệu chuyến**; đã đặt lại `on` ngay sau lần đo.

Kết luận: trần 45–50 chuyến/giây là trần của **một PostgreSQL trên máy đo**, trước hết ở việc ghi commit xuống đĩa, kế đó ở CPU của nó. Hướng cải tiến là giảm việc ghi cho mỗi chuyến, không phải thêm worker. Ở 48 chuyến/giây mỗi chuyến tốn khoảng 188 câu SQL (Trip 85, Matching 96, Driver 7) và khoảng 60 commit. Các nhóm ghi nhiều nhất mỗi chuyến:

| Nhóm | Số câu mỗi chuyến | Ghi chú |
| --- | --- | --- |
| Outbox của Trip: `outbox_deliveries` | 8 dòng tạo, 8 lần cập nhật, 8 lần kiểm lease | 5 tin, trong đó 3 event gửi tới hai đích cùng là Gateway; gộp đích (B2) còn 5 delivery, bớt 3 trong 8 |
| Matching: `matching_searches`, `matching_offers` | 5 lần ghi mỗi bảng, 6 lần khoá | Mỗi bước của search/offer là một transaction riêng |
| Matching: `matching_outbox` | 4 dòng tạo, 4 lần đánh dấu đã gửi, 4 lần claim | Có thể đánh dấu đã gửi theo lô |
| Trip: `trip_status_history`, `outbox` | 4 và 5 dòng tạo | Theo số lần đổi trạng thái của kịch bản đo (tạo, tìm, gán, huỷ) |

### 14.6 Sau B2: event của Trip tới Gateway một lần

Commit `f0d424c`: Trip không còn ghi delivery `notification` khi đích đó không được cấu hình riêng. Cùng kịch bản, tắt observability, mỗi mức một lần; đo cách các lần ở 14.1 khoảng 6 giờ trên cùng máy.

| Đặt chuyến/giây | Được gán | p95 tới `ASSIGNED` | Câu SQL của Trip mỗi chuyến | Commit/giây | CPU PostgreSQL TB / max | Đạt |
| --- | --- | --- | --- | --- | --- | --- |
| 48 (trước B2, mục 14.1) | 5761/5761 | 1,7 giây | 85 | 2878 | 928 / 1143 m | Đạt |
| 48 | 5761/5761 | 2,3 giây | 76 | 2583 | 1143 / 1489 m | Đạt |
| 56 | 5230/5304, bỏ 1413 lượt | 45,8 giây | 77 | 2236 | 1213 / 1387 m | Không đạt |
| 64 (trước B2, mục 14.1) | 5632/5696, bỏ 1984 lượt | 42,7 giây | — | 2827 | 1266 / 1428 m | Không đạt |
| 64 | 5640/5736, bỏ 1945 lượt | 44,5 giây | 77 | 2516 | 1246 / 1387 m | Không đạt |

1. **B2 làm đúng việc của nó:** mỗi chuyến của kịch bản đo bớt 9 câu SQL ở Trip (3 delivery: tạo, cập nhật, kiểm lease) và khoảng 10% commit; Gateway không còn nhận mỗi event hai lần.
2. **B2 không nâng trần:** ở 64 chuyến/giây số chuyến gán gần như y nguyên (5640 so với 5632), và 56 chuyến/giây cũng không đạt. Trần vẫn ở khoảng 45–50 và nay biết thêm là dưới 56.
3. Số commit mỗi giây ở 64 thấp hơn trước (2516 so với 2827) mà thông lượng không đổi, nên **tổng số commit không phải là giới hạn duy nhất**. Thời gian vẫn dồn ở bước tìm xe của Matching (`SEARCHING` → offer p95 39 giây): phần việc của Matching trên `matching_db` mỗi chuyến không đổi sau B2. Điểm nghẽn hẹp hơn kết luận ở 14.5: đường ghi của Matching (khoảng 96 câu SQL mỗi chuyến, mỗi bước một transaction) cùng một process worker một luồng, chứ không phải PostgreSQL nói chung.
4. p95 ở 48 chuyến/giây là 2,3 giây so với 1,7 giây trước B2; với một lần đo mỗi bên, cách nhau nhiều giờ, chưa kết luận được là B2 làm chậm hay nhiễu.

### 14.7 Sau khi giảm ghi của Matching: trần lên 64 chuyến/giây

Commit `7afca59`: `lock_timeout` đặt ở mức kết nối thay vì `SET LOCAL` mỗi transaction; claim job và claim outbox là một câu lệnh, không bọc `BEGIN/COMMIT`; publisher lấy, gửi và đánh dấu tin theo lô tối đa 50; tạo offer gộp ba câu đọc thành một. Cùng kịch bản, tắt observability, đo ngày 2026-11-17 sau khi Docker Desktop khởi động lại.

| Đặt chuyến/giây | Được gán | p95 tới `ASSIGNED` | `SEARCHING` → offer p95 | Offer → publish p95 | Ack GPS p95 | SQL Matching mỗi chuyến | Commit/giây | CPU PostgreSQL TB / max | Đạt |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 48 (lần 1) | 5761/5761 | 2,5 giây | 2,0 giây | 47 ms | 12 ms | 69 | 2174 | 1243 / 1834 m | Đạt |
| 48 (lần 2) | 5761/5761 | 1,1 giây | 0,6 giây | 33 ms | 14 ms | 68 | 2219 | 818 / 941 m | Đạt |
| 56 | 6721/6721 | 0,98 giây | 0,6 giây | 29 ms | 10 ms | 69 | 2563 | 887 / 1030 m | **Đạt** (trước: không) |
| 64 | 7681/7681 | 2,0 giây | 1,3 giây | 50 ms | 19 ms | 69 | 2881 | 1360 / 1700 m | **Đạt** (trước: không) |
| 72 | 5362/5894, bỏ 2460 lượt | 19,6 giây | 15,3 giây | 61 ms | 3002 ms | 80 | 1962 | 972 / 1504 m | Không đạt |

1. **Mức cao nhất đạt ngưỡng tăng từ 48 lên 64 chuyến/giây.** Ở 64, mọi chuyến được gán, lỗi HTTP 0%.
2. Matching từ 98–117 câu SQL mỗi chuyến (sau B2, mục 14.6) xuống 68–69, bớt khoảng 30–40%. Đoạn offer → publish từ p95 13–14 giây (ở 56 và 64 trước đây) xuống dưới 60 ms nhờ publisher theo lô.
3. Lần đo 48 đầu tiên chạy ngay sau khi Docker Desktop khởi động lại và chậm hơn hẳn lần thứ hai; số liệu lần 2 phù hợp với 56 và 64.
4. Ở 72 chuyến/giây ack GPS p95 lên 3 giây và commit/giây giảm còn 1962, tức cả cụm trên máy đo đã quá tải, không chỉ Matching. Trần hiện ở khoảng 64–72 chuyến/giây với 1000 tài xế trên laptop này; chưa đo các mức ở giữa và mỗi mức mới đo một lần.

Kết quả ở `deploy/.local/load/results/2026-11-16T18-2*`, `18-3*` (trần, Gateway), `2026-11-16T19-10-28-963Z` (30 phút) `2026-11-16T19-4*`, `19-5*` (thử nghiệm 14.5) `2026-11-17T00-5*` (sau B2) và `2026-11-17T10-4*`, `10-5*` (sau khi giảm ghi của Matching); tên thư mục theo giờ UTC.

## 15. 5000 tài xế và 5000 khách cùng online (2026-11-17)

Kịch bản C4 trong [kế hoạch kiểm thử](ke-hoach-kiem-thu-hieu-nang.md#56-concurrent-users-testing-nhiều-người-cùng-lúc): 5000 tài xế online (Socket.IO, GPS mỗi 10 giây), 5000 khách mỗi người giữ một phiên `/ws` của Gateway như app đang mở (công cụ mới `riders.cjs`, tham số `--riders-online`), đồng thời đặt 32 chuyến/giây trong 5 phút. Trong cụm, tắt observability, edge cấu hình cho 10000 kết nối (`EDGE_PEAK_DRIVERS=10000`). Commit đang chạy: `b150f94` cộng các sửa ghi ở 15.2.

**Kết quả: không đạt.** Hệ thống không giữ được 5000 khách cùng lúc trên một Gateway.

### 15.1 Các lần chạy

| Lần | Cấu hình | Khách kết nối được (cao nhất) | Chuyến được gán | Lỗi HTTP | Thứ hỏng đầu tiên |
| --- | --- | --- | --- | --- | --- |
| 1 | Chuẩn | — | 0 | — | Edge hết cổng nguồn tới Gateway; tài xế không lên mạng được |
| 2 | Pool keepalive (chưa có hiệu lực, xem 15.2) | 2473/5000 | 0 | 58% | Redis hết bộ nhớ (đầy sẵn từ các lần đo trước), kéo theo Gateway |
| 3 | Như 2, đã dọn Redis | — | 0 | — | Lại edge hết cổng: edge vẫn chạy cấu hình nginx cũ |
| 4 | Edge đã có pool keepalive | 2579/5000 | 41 | 57% | **Gateway hết bộ nhớ** (giới hạn 768 MiB), khởi động lại liên tục |
| 5 | Như 4, Gateway tạm 1536 MiB | **5000/5000** | 1623 trong khoảng 9600 lượt | 33% | **Gateway vẫn hết bộ nhớ** ở 1534 MiB |

Ở lần 5: ack GPS p95 51 ms (đạt), tài xế không rớt kết nối; nhưng khi Gateway bị giết thì mọi phiên `/ws` rớt (khách tự nối lại 41979 lần), báo giá p95 3,4 giây và tạo chuyến p95 2,6 giây vì request dồn chờ Gateway. Truy vấn toàn vẹn dữ liệu sau mỗi lần đều rỗng: không tài xế nào bị gán hai chuyến, không chuyến nào có hai offer đang giữ.

### 15.2 Ba lỗi tìm ra và đã sửa

1. **Edge mở kết nối mới tới Gateway cho mỗi request REST.** `location /api/v1/` đặt `Connection ""` nhưng không có khối `upstream` có `keepalive`, nên nginx vẫn đóng kết nối; lúc hỏng có khoảng 23000 socket `TIME_WAIT` từ edge tới cổng 8080 và nginx báo `Address not available`. Sửa: `upstream gateway_rest { keepalive 256; }` trong `deploy/nginx.conf`.
2. **`kube-up` không khởi động lại edge khi cấu hình nginx đổi.** File cấu hình được mount bằng `subPath`, không tự cập nhật; bản sửa 1 vì vậy chưa có hiệu lực ở lần 3. Sửa: `generate.cjs` gắn mã băm cấu hình nginx vào pod template của edge, giống mã băm env của các service.
3. **Redis giữ dữ liệu chuyến 7 ngày và không có `maxmemory`.** Khoảng 650000 key chống trùng event của Gateway (`gw:trip-event:*`, `gw:trip-version:*`) và 162000 key offer của Realtime (`realtime:offer:*`) từ các lần đo trước đã chiếm 243 MiB trên giới hạn 256 MiB. Ước tính ở 32 chuyến/giây Redis tăng khoảng 130 MB mỗi giờ (tính từ số key mỗi chuyến, chưa đo trực tiếp). **Chưa sửa tận gốc**: lần này chỉ xoá dữ liệu cũ trong Redis local. Cần rút hạn sống của hai nhóm key này và đặt giới hạn bộ nhớ cho Redis. Sau khi Redis bị giết, realtime-api không tự kết nối lại được và phải khởi động lại pod.

### 15.3 Điểm gãy: bộ nhớ của Gateway cho phiên `/ws`

Với 768 MiB, Gateway bị giết khi khoảng 2500 khách đã kết nối; với 1536 MiB, đủ 5000 khách kết nối được nhưng Gateway vẫn chạm 1534 MiB và bị giết. Ước tính **khoảng 300 KB bộ nhớ cho mỗi phiên `/ws`** (1,5 GB cho 5000 phiên), trong khi realtime-api giữ 5000 kết nối Socket.IO của tài xế chỉ với khoảng 280 MiB. Chưa tìm ra phần nào trong Gateway tốn bộ nhớ (bộ đệm WebSocket của Tomcat, đăng ký phiên, hay luồng nhận event từ Redis); cần heap dump.

Hướng xử lý, chưa làm: tìm nguyên nhân bằng heap dump rồi giảm bộ nhớ mỗi phiên; đặt giới hạn số phiên `/ws` trên một Gateway để từ chối có kiểm soát thay vì bị giết; hoặc chạy nhiều replica Gateway (cần phân phối event theo phiên qua Redis, chưa có).

Kết quả ở `deploy/.local/load/results/2026-11-17T13-35-16-700Z`, `14-10-24-166Z` và `14-34-11-615Z`.

