# Kế hoạch kiểm thử hiệu năng

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Toàn hệ thống |
| Rà soát | 2026-11-17 |
| Quy ước | [Format và số liệu](quy-uoc-tai-lieu.md) |

Kế hoạch kiểm thử hiệu năng cho hệ thống gọi xe trên Kubernetes local, viết cho nhóm và hội đồng. Gồm bảy loại kiểm thử: load, stress, soak, Realtime và GPS, hiệu năng database, nhiều người dùng đồng thời, đăng nhập và rate limit. Mỗi loại ghi mục tiêu, kịch bản, lệnh chạy, chỉ số theo dõi, ngưỡng đạt và những gì đã có kết quả. Số liệu đã đo nằm trong [báo cáo kiểm thử tải](bao-cao-kiem-thu-tai.md); công cụ nằm ở [deploy/load](../deploy/load/README.md). Bản trước của tài liệu này (2026-10-29) viết trước mọi cải tiến; lịch sử của nó nằm trong git.

## 1. Mục tiêu và hiện trạng

**Quy mô mục tiêu: 5000 tài xế online và 32 chuyến/giây** (khoảng 115000 chuyến/giờ), trên một cụm Kubernetes local.

| Câu hỏi | Đã biết (nguồn) | Còn phải chứng minh |
| --- | --- | --- |
| Chịu được bao nhiêu chuyến/giây với 1000 tài xế? | 64 đạt, 72 không ([báo cáo, mục 14.7](bao-cao-kiem-thu-tai.md#147-sau-khi-giảm-ghi-của-matching-trần-lên-64-chuyếngiây)) | Lặp lại 3 lần mỗi mức; đo 66–70 |
| Chịu được 5000 tài xế không? | Đạt ở 8 chuyến/giây ([mục 12.3](bao-cao-kiem-thu-tai.md#123-5000-tài-xế)) | **5000 tài xế × 32 chuyến/giây chưa đo**: đây là mục tiêu chính |
| Chạy lâu có ổn định không? | 30 phút ở 16 chuyến/giây, 1000 tài xế: ổn định ([mục 14.3](bao-cao-kiem-thu-tai.md#143-chạy-liên-tục-30-phút-ở-16-chuyếngiây)) | 2 giờ ở quy mô mục tiêu; vòng dọn outbox; làn sóng nối lại khi JWT hết hạn |
| Đăng nhập chịu bao nhiêu? | Khách 15 lượt/giây p95 77 ms ([mục 6.6](bao-cao-kiem-thu-tai.md#66-đăng-nhập-và-rate-limit-theo-ip)) | Điểm gãy của User; OTP tài xế; đợt đăng nhập buổi sáng |
| Rate limit có đúng không? | Theo IP thật, chặn ở lượt 11 của OTP mock ([mục 6.6](bao-cao-kiem-thu-tai.md#66-đăng-nhập-và-rate-limit-theo-ip)) | Kiểm đủ 4 endpoint với cấu hình mặc định 5 lượt/phút |

## 2. Môi trường và công cụ

| Thành phần | Có sẵn | Ghi chú |
| --- | --- | --- |
| Cụm | Docker Desktop Kubernetes, 1 node, VM 10 CPU / 8 GB | Bộ tạo tải chạy cùng máy, nên ở tải rất cao nó tranh CPU với hệ thống |
| Tạo tải | `deploy/load/run.cjs`: tài xế giả lập (Socket.IO, GPS, nhận offer) và k6 đặt chuyến | `--in-cluster 1` chạy trong pod `load-runner`, không qua port-forward |
| Đăng nhập | `deploy/load/login.js` (k6, tăng dần số lượt/giây) | Chỉ có đăng nhập khách; OTP tài xế chưa có script |
| Kết quả mỗi lần chạy | `deploy/.local/load/results/<giờ UTC>/`: `summary.json`, `k6.json`, `drivers.json`, `pods.json`, `sql.json`, `segments.json` | Gồm CPU/RAM từng pod, thời gian từng đoạn, thống kê `pg_stat_statements`, commit/giây |
| Quan sát | `OBSERVABILITY=on`: Grafana, Prometheus, Jaeger; sáu service Node và Gateway | Tốn thêm 20–50% CPU; **tắt khi đo trần** |

Trước mỗi đợt đo:

1. `docker info` chạy được (Docker Desktop tắt khi máy nghỉ; một lần đo dừng ngay từ đầu thường là do đây).
2. Mọi pod `1/1 Running`; `BACKEND_URL=http://127.0.0.1:18081 node deploy/smoke.cjs` qua.
3. Không còn biến ghi đè từ thử nghiệm trước: `kubectl set env` tồn tại qua `kube-up`, nên kiểm lại các biến đã từng đặt tay (ví dụ `AUTH_MAX_ATTEMPTS` ở 5.7) và gỡ bằng `kubectl set env deployment/<tên> <BIẾN>-`.
4. Ghi commit đang chạy và cấu hình đặc biệt (observability, số replica) vào báo cáo.

## 3. Dữ liệu thử nghiệm

| Dữ liệu | Số lượng cần | Lệnh | Ghi chú |
| --- | --- | --- | --- |
| Tài xế | 5000 | `node deploy/load/accounts.cjs seed --drivers 5000` | Ghi thẳng vào `driver_db`, phiên OTP lấy trong pod driver-api |
| Khách | 5000 | `node deploy/load/accounts.cjs seed --riders 5000` | Đã seed 2026-11-17. Đi qua Gateway; stack local đặt `AUTH_MAX_ATTEMPTS=1000` nên seed không bị chặn |
| Vị trí | — | `--radius 6000` | Tài xế rải trong 6 km quanh Hoàn Kiếm; điểm đón trong 1,5 km |
| Bảng lớn (cho 5.5) | 1 triệu dòng `outbox_deliveries`, `matching_outbox` đã gửi | Script cần viết (mục 9) | Để thấy index và vòng dọn làm việc khi bảng đã lớn |

Số khách giới hạn số chuyến chờ cùng lúc (mỗi VU k6 dùng một khách). Ở 32 chuyến/giây, thời gian tới khi có tài xế khoảng 1 giây cộng bước huỷ, nên 1000 khách là đủ; chế độ đợt cần một khách cho mỗi chuyến.

## 4. Ngưỡng đạt

Một lần đo **đạt** khi mọi dòng dưới đây đạt cùng lúc. Đây là ngưỡng nhóm đang dùng, chưa phải SLO đã cam kết.

| Chỉ số | Ngưỡng |
| --- | --- |
| Tạo chuyến → `ASSIGNED` p95 | ≤ 10 giây (tài xế giả lập nhận ngay) |
| Báo giá p95 / p99 | ≤ 300 / 800 ms |
| Tạo chuyến p95 | ≤ 300 ms |
| Ack GPS p95 / p99 | ≤ 200 / 1000 ms |
| Offer: publish → tài xế nhận p95 | ≤ 500 ms |
| Đăng nhập khách p95 | ≤ 500 ms |
| Lỗi HTTP (5xx, timeout, 4xx ngoài nghiệp vụ) | < 0,5% |
| Lượt k6 bị bỏ (`droppedIterations`) | 0 |
| Tài xế có hai chuyến đang mở, chuyến có hai offer đang giữ | 0 (truy vấn ở mục 5.5) |
| CPU mỗi pod, trung bình | ≤ 70% giới hạn của pod |
| PostgreSQL | Không deadlock; cache hit ≥ 99%; số kết nối dưới pool |
| Soak | RAM không tăng quá 10% sau 10 phút đầu; không restart; p95 từng phút trong ngưỡng |

**Quy tắc lặp lại:** mỗi mức đo **3 lần**, lấy trung vị; một lần lệch xa thì ghi lại cả ba. Hai lần đo cùng mức trên laptop này đã lệch tới gấp đôi p95, nên một lần đo không đủ để kết luận cải thiện hay thụt lùi.

## 5. Các loại kiểm thử

### 5.1 Load testing (tải dự kiến)

Mục tiêu: chứng minh hệ thống đạt ngưỡng ở quy mô mục tiêu và giữ được qua mỗi lần sửa code.

| ID | Tài xế | Chuyến/giây | Thời gian | Trạng thái |
| --- | --- | --- | --- | --- |
| L1 | 1000 | 16 | 2 phút × 3 | Đã đo nhiều lần, đạt; dùng làm **kiểm tra hồi quy** sau mỗi thay đổi |
| L2 | 5000 | 16 | 5 phút × 3 | Chưa đo (5000 tài xế mới đo tới 8 chuyến/giây) |
| L3 | 5000 | 32 | 5 phút × 3 | **Chưa đo: mục tiêu chính** |

```bash
node deploy/load/run.cjs --drivers 5000 --radius 6000 --rate 32 --duration 5m --warmup 60 --in-cluster 1 --events ws
```

Theo dõi: p95 tới `ASSIGNED` và từng đoạn (`segments`), báo giá, ack GPS, CPU từng pod, commit/giây. Ở 5000 tài xế, bước warmup cần lâu hơn (60 giây) để mọi tài xế ONLINE và có GPS mới.

### 5.2 Stress testing (tìm giới hạn và cách hỏng)

Mục tiêu: biết mức gãy, **thành phần gãy đầu tiên**, và hệ thống có hồi phục sau khi giảm tải không.

| ID | Kịch bản | Trạng thái |
| --- | --- | --- |
| S1 | 1000 tài xế, tăng 48 → 56 → 64 → 72 → 80 chuyến/giây, 2 phút mỗi bậc, dừng ở bậc đầu không đạt | Đã đo một lần: 64 đạt, 72 không; còn lặp 3 lần và đo 66–70 |
| S2 | 5000 tài xế, tăng 32 → 40 → 48 → … tới bậc không đạt | Chưa đo |
| S3 | Đột biến (spike): 3000 khách đặt trong 2 phút trên nền 3500 tài xế | Chưa đo; dùng chế độ đợt `--trips` |
| S4 | Hồi phục: ngay sau bậc không đạt của S1, chạy L1; phải đạt lại trong 5 phút | Chưa đo |

```bash
node deploy/load/run.cjs --drivers 1000 --radius 6000 --rate 72 --duration 2m --warmup 30 --in-cluster 1 --events ws
```

```bash
node deploy/load/run.cjs --drivers 3500 --radius 6000 --ramp 25 --trips 3000 --rate 25 --drain 900 --in-cluster 1
```

Ở mỗi bậc không đạt, ghi: đoạn nào dồn (`SEARCHING` → offer, offer → publish…), pod nào chạm giới hạn CPU, commit/giây, các phiên PostgreSQL đang chờ gì (lấy mẫu `pg_stat_activity`, mục 5.5), lần thử lại trong log `matching_job_retry`. Lần gần nhất, ở 72 chuyến/giây ack GPS lên 3 giây: toàn cụm quá tải chứ không riêng một service.

### 5.3 Soak testing (chạy lâu)

Mục tiêu: phát hiện rò RAM, bảng phình, vòng dọn dữ liệu không theo kịp, và các đợt chậm theo chu kỳ.

| ID | Kịch bản | Trạng thái |
| --- | --- | --- |
| K1 | 1000 tài xế, 16 chuyến/giây, 30 phút | Đã đo 2026-11-17: 28800/28800, p95 0,93 giây; có hai gợn dưới một phút |
| K2 | 5000 tài xế, 16 chuyến/giây, 2 giờ | Chưa đo |
| K3 | Như K2 nhưng `OUTBOX_RETENTION_MS=1800000` (30 phút) cho Trip và Matching | Chưa đo; để vòng dọn outbox thật sự xoá dữ liệu trong lúc chạy |

```bash
node deploy/load/run.cjs --drivers 5000 --radius 6000 --rate 16 --duration 120m --warmup 60 --in-cluster 1 --events ws --login 1
```

`--login 1` là bắt buộc khi chạy quá khoảng 14 phút: token khách sống 15 phút; thiếu tham số này thì nửa sau lần chạy không gọi được API (đã gặp ở lần chạy K1 đầu tiên).

Theo dõi theo từng phút: số chuyến được gán và p95 (truy vấn `trip_status_history`, như [mục 14.3](bao-cao-kiem-thu-tai.md#143-chạy-liên-tục-30-phút-ở-16-chuyếngiây)); RAM từng pod đầu → cuối; dung lượng Redis; số dòng `outbox_deliveries`, `matching_outbox`; log `outbox_purged`; số lần tài xế rớt kết nối và thời điểm. Đạt khi thêm các ngưỡng soak ở mục 4 và số dòng outbox ngừng tăng sau khi vòng dọn bắt đầu chạy (K3).

### 5.4 Realtime và GPS testing

Mục tiêu: kênh GPS và Socket.IO của tài xế, kênh `/ws` của khách giữ độ trễ thấp khi đông người, và hồi phục khi kết nối rớt hàng loạt.

| ID | Kịch bản | Chỉ số | Trạng thái |
| --- | --- | --- | --- |
| R1 | 5000 tài xế, GPS mỗi 10 giây (500 bản tin/giây), 5 phút, gần như không đặt chuyến | Ack GPS p95/p99, CPU realtime-api, Redis | Đã có số ở 5000 tài xế khi có đặt chuyến (8 chuyến/giây) |
| R2 | 5000 tài xế, GPS mỗi 3 giây (khoảng 1670 bản tin/giây) | Như R1; tìm mức ack vượt 200 ms | Chưa đo |
| R3 | Nối lại hàng loạt: xoá pod realtime-api trong lúc L2 chạy | Thời gian tới khi ≥ 99% tài xế gửi GPS lại; chuyến bị trễ trong khoảng đó | Chưa đo |
| R4 | Nối lại do JWT hết hạn: 5000 tài xế đăng nhập cùng lúc nên hết hạn cùng lúc (xảy ra tự nhiên trong K2) | Gợn p95 quanh các mốc 15 phút | Đã thấy gợn ở K1, chưa đo riêng |
| R5 | Độ trễ giao offer: publish → tài xế nhận | p95 ≤ 500 ms | Đo sẵn trong mọi lần chạy (`publishToAccept`) |
| R6 | Độ trễ sự kiện `/ws` tới khách sau khi chuyến đổi trạng thái | p95 ≤ 1 giây | **Chưa đo được**: cần thêm mốc thời gian (mục 9) |
| R7 | GPS cũ hơn 30 giây không được dùng để mời | Không offer nào gửi cho tài xế mất GPS | Có trong test tích hợp Matching; chưa kiểm dưới tải |

```bash
node deploy/load/run.cjs --drivers 5000 --radius 6000 --rate 1 --duration 5m --warmup 60 --gps-ms 3000 --in-cluster 1 --events ws
```

```bash
kubectl --context docker-desktop -n chande-local delete pod -l app=realtime-api
```

Bật observability cho R1–R3 để xem `realtime_location_update_duration` và độ trễ event loop của realtime-api trên Grafana.

### 5.5 Database performance testing

Mục tiêu: biết mỗi chuyến tốn bao nhiêu việc ở PostgreSQL, câu nào tốn nhất, và giới hạn của chính PostgreSQL trên máy đo.

| ID | Kiểm tra | Cách làm | Trạng thái |
| --- | --- | --- | --- |
| D1 | Số câu SQL mỗi chuyến theo database | `sql.json` của mỗi lần chạy chia cho số chuyến | Có sẵn mỗi lần chạy. Hiện: Trip 76, Matching 69, Driver 7 |
| D2 | Câu tốn nhất | `sql.json` sắp theo tổng thời gian | Có sẵn |
| D3 | Commit/giây, cache hit, kết nối mỗi database, deadlock | `database` trong `pods.json` | Có sẵn; trần quan sát khoảng 2900 commit/giây |
| D4 | Phiên đang chờ gì ở bậc gãy | Lấy mẫu `pg_stat_activity` mỗi giây trong lúc chạy (lệnh dưới) | Đã làm một lần ([mục 14.5](bao-cao-kiem-thu-tai.md#145-thử-nghiệm-tìm-điểm-nghẽn-ở-64-chuyếngiây)) |
| D5 | Bảng lớn: index và vòng dọn khi `outbox_deliveries`, `matching_outbox` có 1 triệu dòng | Nạp dữ liệu cũ rồi chạy L1; `EXPLAIN (ANALYZE, BUFFERS)` câu claim và câu dọn | Chưa làm; cần script nạp (mục 9) |
| D6 | Toàn vẹn dữ liệu sau mỗi lần chạy | Hai truy vấn dưới | Chưa tự động hoá |

```bash
for i in $(seq 1 60); do kubectl --context docker-desktop -n chande-local exec deploy/postgres -- psql -U backend_root -d postgres -At -F'|' -c "select datname, state, coalesce(wait_event_type,'cpu')||':'||coalesce(wait_event,'running') from pg_stat_activity where backend_type='client backend' and state<>'idle' and pid<>pg_backend_pid()"; sleep 1; done | sort | uniq -c | sort -rn
```

```sql
-- trip_db: tài xế có hơn một chuyến đang mở (phải rỗng)
SELECT driver_id, count(*) FROM trips WHERE status IN ('ASSIGNED','DRIVER_ARRIVED','IN_PROGRESS') GROUP BY driver_id HAVING count(*) > 1;
-- matching_db: chuyến có hơn một offer đang giữ (phải rỗng; index duy nhất cũng chặn việc này)
SELECT trip_id, count(*) FROM matching_offers WHERE status IN ('PENDING','ASSIGNMENT_PENDING','ASSIGNED') GROUP BY trip_id HAVING count(*) > 1;
```

**Quy tắc hồi quy:** số câu SQL mỗi chuyến của một database tăng quá 10% so với lần đo trước thì phải giải thích trong commit hoặc báo cáo. `synchronous_commit=off` chỉ dùng để chẩn đoán và phải đặt lại ngay sau lần đo.

### 5.6 Concurrent users testing (nhiều người cùng lúc)

Mục tiêu: nhiều người dùng thao tác cùng lúc không làm sai dữ liệu và không làm chậm nhau quá ngưỡng.

| ID | Kịch bản | Đạt khi | Trạng thái |
| --- | --- | --- | --- |
| C1 | 5000 tài xế online, 3000 khách mỗi người đặt một chuyến trong 2 phút (chế độ đợt), giữ chuyến | ≥ 95% chuyến được gán trong 3 phút; mọi chuyến được gán trước `--drain`; D6 rỗng | Chưa đo (kịch bản E6 trong đề xuất) |
| C2 | 3000 khách cùng mở app: đọc chuyến và lịch sử song song với L3 | p95 đọc ≤ 300 ms; L3 vẫn đạt | Chưa có script đọc riêng (mục 9) |
| C3 | Tranh chấp: nhiều chuyến cùng nhắm một tài xế; tài xế nhận và khách huỷ cùng lúc | 0 tài xế bị gán hai chuyến; chuyến huỷ không bị gán | Đã có test tích hợp (`match.test.ts`, `decisions.test.ts`); dưới tải kiểm bằng D6 |
| C4 | **5000 tài xế và 5000 khách cùng online** (mỗi khách giữ một phiên `/ws`), đặt 32 chuyến/giây trong 5 phút | Mọi khách giữ được kết nối; các ngưỡng ở mục 4 đạt | **Đã chạy 2026-11-18 (2 lần): giữ được kết nối, ngưỡng mục 4 chưa đạt.** Sau khi Gateway tắt nén `permessage-deflate`: 5000/5000 khách online suốt bài, khoảng 8750 chuyến được gán, lỗi HTTP dưới 0,2%, Gateway không khởi động lại (1 GiB: cao nhất 875 MB, dư 19%). Trượt vì cả cụm bão hoà CPU: gán chuyến p95 33 giây, báo giá p95 0,9–1,4 giây, ack GPS p95 0,9–1,2 giây, khoảng 800 lượt bị bỏ ([báo cáo, mục 15.6–15.7](bao-cao-kiem-thu-tai.md#156-nguyên-nhân-thật-nén-permessage-deflate-2026-11-18)) |

```bash
node deploy/load/run.cjs --drivers 5000 --radius 6000 --ramp 25 --trips 3000 --rate 25 --drain 900 --in-cluster 1
```

C4 cần edge đủ chỗ cho cả kết nối của khách, nên deploy với `EDGE_PEAK_DRIVERS=10000`:

```bash
EDGE_PEAK_DRIVERS=10000 node deploy/run.cjs kube-up
```

```bash
node deploy/load/run.cjs --drivers 5000 --radius 6000 --rate 32 --duration 5m --warmup 60 --in-cluster 1 --events ws --riders-online 5000
```

### 5.7 Login và rate limiting

Mục tiêu: biết đăng nhập chịu được bao nhiêu lượt/giây, và giới hạn số lần thử chặn đúng người, đúng số lượt, đúng endpoint.

Cấu hình liên quan: Gateway giới hạn **5 request/phút cho mỗi cặp (endpoint, IP thật)** trên 4 endpoint: đăng ký và đăng nhập khách (User), yêu cầu và xác nhận OTP tài xế (Driver); vượt thì trả 429 kèm `Retry-After` ([tài liệu Gateway, mục 5](../service/api-gateway/docs/api-gateway.md#5-giới-hạn-số-lần-thử-rate-limit)). OTP mock của Driver tự giới hạn thêm 10 lượt/phút mỗi IP. Stack load local đặt `AUTH_MAX_ATTEMPTS=1000` để seed và đo thông lượng.

**Thông lượng đăng nhập**

| ID | Kịch bản | Chỉ số | Trạng thái |
| --- | --- | --- | --- |
| T1 | Khách đăng nhập tăng 5 → 10 → 15 → 20 → 25 → 30 lượt/giây, 1 phút mỗi bậc | p95 ≤ 500 ms; CPU user-api; bậc đầu không đạt | Đã đo tới 15 (p95 77 ms); BCrypt khoảng 60 ms mỗi lượt nên ước tính một replica gãy ở 15–20 |
| T2 | Tài xế yêu cầu và xác nhận OTP | Như T1, ở driver-api | Chưa có script (mục 9) |
| T3 | Đợt đăng nhập buổi sáng: 3000 khách trong 5 phút (10 lượt/giây) đồng thời với L2 | T1 đạt; L2 vẫn đạt | Chưa đo |

```bash
k6 run -e STAGES=5,10,15,20,25,30 -e STAGE=1m deploy/load/login.js
```

**Rate limit đúng** (chạy với cấu hình mặc định 5 lượt/phút, không phải 1000)

| ID | Kiểm tra | Kỳ vọng |
| --- | --- | --- |
| T4 | Từ một IP, gọi `POST /api/v1/auth/login` 6 lần trong một phút | 5 lần đầu qua (đúng hoặc sai mật khẩu đều tính), lần 6 nhận 429 có `Retry-After` |
| T5 | Chờ hết `Retry-After` rồi gọi lại | Qua; cửa sổ trượt, không chặn cả phút |
| T6 | Cùng lúc từ IP thứ hai | Có quota riêng, không bị ảnh hưởng bởi IP thứ nhất |
| T7 | Gửi kèm `X-Forwarded-For` giả, mỗi lần một IP khác | Vẫn bị tính theo IP thật (edge ghi đè header) |
| T8 | Hết quota của `login` nhưng gọi `register` hoặc OTP | Mỗi endpoint một quota riêng |
| T9 | Lặp T4 cho `register`, `otp/request`, `otp/verify` | Như T4 |

Bật cấu hình mặc định cho T4–T9:

```bash
kubectl --context docker-desktop -n chande-local set env deployment/gateway-api AUTH_MAX_ATTEMPTS=5
```

Trả lại cấu hình load sau khi xong:

```bash
kubectl --context docker-desktop -n chande-local set env deployment/gateway-api AUTH_MAX_ATTEMPTS-
```

Phần chưa nằm trong kế hoạch này: dò mật khẩu, xoay IP, và giới hạn khi Gateway chạy nhiều instance (giới hạn đang lưu trong bộ nhớ từng instance).

## 6. Thứ tự chạy và thời gian ước tính

| Bước | Nội dung | Thời gian máy |
| --- | --- | --- |
| 0 | Chuẩn bị (mục 2), seed 5000 tài xế và 3000 khách, viết các script còn thiếu (mục 9) | Nửa ngày |
| 1 | L1 × 3 làm đường cơ sở; T4–T9 | 1 giờ |
| 2 | L2, L3 × 3; R1, R2 | 2 giờ |
| 3 | S1 (lặp lại), S2, S4; D4 ở bậc gãy | 2 giờ |
| 4 | C1, C2, C4, S3; T1–T3 | 2 giờ |
| 5 | D5 (bảng lớn); R3 | 1 giờ |
| 6 | K2 hoặc K3 (2 giờ), qua đêm nếu cần | 2–3 giờ |
| 7 | Viết báo cáo; mỗi phát hiện quan trọng thành một đề xuất | Nửa ngày |

Không chạy hai bài đo cùng lúc trên một cụm. Sau mỗi thay đổi code, chạy lại L1 trước khi đo tiếp.

## 7. Thu thập và báo cáo

- Mỗi lần chạy giữ nguyên thư mục kết quả; báo cáo ghi tên thư mục (giờ UTC), commit và cấu hình đặc biệt.
- Báo cáo mỗi loại kiểm thử: bảng số liệu, ngưỡng nào không đạt, đoạn nào dồn thời gian, pod nào chạm giới hạn, và kết luận kèm mức độ chắc chắn (đo một lần hay ba lần; suy luận hay đã thử nghiệm).
- Khi kết quả bác một suy luận trước đó, sửa suy luận cũ trong báo cáo thay vì chỉ thêm mục mới (như [mục 14.5](bao-cao-kiem-thu-tai.md#145-thử-nghiệm-tìm-điểm-nghẽn-ở-64-chuyếngiây)).
- Sau một đợt tối ưu: đo lại đúng kịch bản đã cho thấy điểm nghẽn, cùng cấu hình, rồi mới đo tiếp mức cao hơn.

## 8. Giới hạn của môi trường local

- Một laptop: bộ tạo tải, toàn bộ service và PostgreSQL dùng chung CPU và đĩa; trần đo được là trần của máy này, không phải của kiến trúc.
- PostgreSQL ghi xuống đĩa ảo của Docker Desktop, nên trần commit (khoảng 2900/giây) phụ thuộc máy.
- Mọi service một replica; chưa đo khả năng mở rộng ngang. Cụm nhiều node (đề xuất E4) cần cho câu hỏi đó.
- Tài xế giả lập nhận offer ngay; thời gian tới khi có tài xế của người thật sẽ lâu hơn nhiều.
- Trước khi chạy ở môi trường dùng chung: thay việc seed bằng SQL trực tiếp bằng cơ chế tạo tài khoản test được phép, và thống nhất ngưỡng ở mục 4 thành SLO.

## 9. Công cụ còn thiếu

| Thiếu | Cần cho | Ước lượng |
| --- | --- | --- |
| Script OTP tài xế qua Gateway, mỗi tài xế giả một IP qua `X-Driver-Client-IP` và proxy token trong cụm | T2 | Nửa ngày |
| Script đọc chuyến và lịch sử của khách song song với đặt chuyến | C2 | 2 giờ |
| Mốc thời gian sự kiện `/ws` trong k6 so với `trip_status_history` | R6 | 2 giờ |
| Script nạp 1 triệu dòng outbox đã gửi | D5 | 1 giờ |
| Chạy D6 tự động cuối mỗi lần `run.cjs` | Mọi bài | 1 giờ |
| Thống kê theo từng phút tự động trong `summary.json` | Soak | 1 giờ |
