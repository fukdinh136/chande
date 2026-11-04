# Báo cáo kiểm thử tải

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Toàn hệ thống |
| Rà soát | 2026-11-04 |
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

Theo [kế hoạch](ke-hoach-kiem-thu-hieu-nang.md#5-ngưỡng-đạtkhông-đạt-đề-xuất): một mức tải **đạt** khi đồng thời có tạo chuyến → `ASSIGNED` p95 ≤ 10 giây, báo giá p95 ≤ 300 ms, ack GPS p95 ≤ 200 ms và lỗi HTTP < 0,5%.

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

Mỗi lần đo ghi `summary.json`, `k6.json`, `segments.json`, `sql.json`, `pods.json` và `drivers.json` vào `deploy/.local/load/results/<thời điểm>/` (không commit). Danh sách 21 lần đo trong báo cáo này nằm ở `deploy/.local/load/campaign/index.tsv` trên máy đo.
