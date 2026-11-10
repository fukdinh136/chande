# Đề xuất cải tiến hiệu năng

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Toàn hệ thống |
| Rà soát | 2026-11-10 |
| Quy ước | [Format và số liệu](quy-uoc-tai-lieu.md) |

Tài liệu duy nhất gom các đề xuất cải tiến hiệu năng: kết quả nhóm cải tiến đã làm, điểm nghẽn còn lại, đề xuất tiếp theo kèm chi phí, đối chiếu ADR và lộ trình. Mọi căn cứ lấy từ [báo cáo kiểm thử tải](bao-cao-kiem-thu-tai.md) ngày 2026-11-04; test case và ngưỡng nằm trong [kế hoạch kiểm thử hiệu năng](ke-hoach-kiem-thu-hieu-nang.md).

Các đề xuất bám theo [kiến trúc mục tiêu](kien-truc-muc-tieu.md) và [ADR](adr/README.md), không thêm công nghệ mà tài liệu đó đã loại (Kafka, sharding, service mesh). Con số "sau cải tiến" của các đề xuất chưa làm là ước tính, phải đo lại để xác nhận. Nhóm D (chịu lỗi và vận hành) lấy căn cứ từ code và tài liệu triển khai, không từ bài đo.

## 1. Tóm tắt

Nhóm A (cải tiến rẻ) và cải tiến môi trường đo E1–E3 đã làm xong và đã đo:
- Mức tải cao nhất đạt mọi ngưỡng tăng từ **2 lên 6 chuyến/giây** với 1000 tài xế.
- Thông lượng gán tối đa tăng từ khoảng 3 lên khoảng **10,5 chuyến/giây**.
- Hệ thống chịu được **5000 tài xế online**.
- Đạt và vượt mục tiêu đề ra cho bước đầu, vốn là 4–5 chuyến/giây.

Điểm nghẽn đã chuyển từ hàng đợi sang **cách kiểm tra điều kiện tài xế**:
- Mỗi lần tìm, Driver kiểm tra khoảng 200 tài xế trong 2 km, **từng người một**: 4 câu SQL và 2 lệnh Redis mỗi người, cộng một câu SQL ở Trip. Ở 12 chuyến/giây, việc này tốn khoảng 1400 câu SQL cho mỗi chuyến (gồm các lần tìm lại).
- Hệ quả 1: từ 8 chuyến/giây, driver-api (một process Node) chạm 1 core, Routing trả `ROUTING_BUSY`, và chuyến phải chờ.
- Hệ quả 2: PostgreSQL lên khoảng 1 core vì khoảng 14000 câu lệnh/giây, dù tổng thời gian thực thi chỉ khoảng 0,1 core.

Thêm worker hay tăng tài nguyên không giải quyết được; đã thử Routing 8 worker, không cải thiện.

| Bước | Nội dung | Công sức (ước tính) | Thêm tài nguyên | Hiệu quả kỳ vọng (cần đo lại) |
| --- | --- | --- | --- | --- |
| 1 | Kiểm tra điều kiện theo lô thật sự (B7) và giới hạn số ứng viên theo [ADR-0001](adr/0001-matching-so-huu-tim-ung-vien.md) (B1) | khoảng 3–4 ngày người (B1 đã tính trong Phase 1) | Không | Câu SQL kiểm tra tài xế cho mỗi chuyến từ khoảng 1400 xuống khoảng 10–20; mức đạt ngưỡng lên khoảng 10–12 chuyến/giây |
| 2 | Observability (B6), làm mới token có jitter (B5), 2 replica driver-api (B4) | B6 đã tính trong Phase 1; B5, B4 khoảng 2 ngày | khoảng 0,9 GB | Giải thích được hai hiện tượng còn mở; tài xế lên ca hay làm mới token đồng loạt không gây chậm |
| 3 | Đo lại trọn kịch bản 3000 khách và 3500 tài xế trong cụm (E6); tuỳ chọn thuê cụm 1 ngày (E4) | khoảng 1 ngày (E6); 2 ngày (E4) | E4: ước tính 5–20 USD | Số liệu thật cho kịch bản đột biến |

Ngoài hiệu năng, [mục 5.4](#54-nhóm-d-chịu-lỗi-và-vận-hành) đề xuất nhóm D: circuit breaker, rolling update, RPO/RTO kèm diễn tập khôi phục, và tài liệu saga cho luồng chuyến đi. Tổng khoảng 3–3,5 ngày người, không thêm tài nguyên thường trực.

Gán 3000 chuyến trong khoảng 2 phút (25 chuyến/giây) vẫn cần nhiều máy; mục tiêu đó vượt hạ tầng demo trên một MacBook ([mục 8](#8-kỳ-vọng-cho-kịch-bản-3000-khách)).

## 2. Hiện trạng đo được

Đo trên Docker Desktop Kubernetes một node, ngày 2026-11-04, sau nhóm A và E1–E3. Chi tiết trong [báo cáo](bao-cao-kiem-thu-tai.md).

| Chỉ số | Mốc ban đầu (2026-10-29) | Hiện tại (2026-11-04) |
| --- | --- | --- |
| Mức cao nhất đạt ngưỡng (1000 tài xế) | 2 chuyến/giây, p95 4,0 giây | **6 chuyến/giây**, p95 1,0 giây, báo giá p95 25–66 ms |
| 8 chuyến/giây | 110 chuyến được gán, lỗi HTTP 3,9% | Cách đo cũ: 961/961, lỗi 0%, p95 37 giây. Giống app: 3,2–4,4 chuyến/giây được gán, p95 41–52 giây |
| Thông lượng gán tối đa | khoảng 2,5–3 chuyến/giây | khoảng 10,5 chuyến/giây (đặt 16 chuyến/giây, khách chờ hơn 20 giây) |
| Tài xế online | Gãy trước 5000; môi trường đo sập ở khoảng 3500 kết nối | 5000 tài xế, 0 lỗi kết nối, p95 1,3 giây ở 4 chuyến/giây |
| Khi rảnh, tới `ASSIGNED` | khoảng 3 giây | khoảng 0,6 giây |
| Chạy 30 phút | Chưa đo | Ổn định, RAM không tăng; một đợt chậm 3 phút chưa rõ nguyên nhân |
| Đăng nhập | Mọi người dùng chung một quota | Mỗi IP một quota; 15 lượt/giây p95 77 ms |
| CPU ở 8–12 chuyến/giây (giống app) | — | driver-api đỉnh 1,1–1,2 core; PostgreSQL 0,7–1,1 core; Gateway, Trip, Matching, Routing dưới 0,3 core |

## 3. Kết quả nhóm cải tiến đã làm

| ID | Cải tiến | Kỳ vọng khi đề xuất | Kết quả đo được | Đánh giá |
| --- | --- | --- | --- | --- |
| A1, A5 | Outbox Trip lặp khi lô đầy, nghỉ 250 ms khi rảnh ([ADR-0008](adr/0008-xu-ly-hang-doi-lien-tuc.md)) | Outbox Trip không còn là trần | Accept → `ASSIGNED` ở 4 chuyến/giây: p95 7,0 → 0,3 giây | Đạt |
| A2 | Publisher Matching vòng riêng, đánh thức ngay | Offer → publish dưới 100 ms | p95 8017 → 12 ms ở 4 chuyến/giây | Vượt |
| A3 | Worker Matching dạng pool, giữ offer bằng `expires_at` | Thông lượng worker gấp 2–3 lần | `SEARCHING` → offer p95 53,1 → 0,5 giây ở 4 chuyến/giây; matching-worker dưới 0,15 core | Vượt |
| (mới) | Partial index cho claim publisher Matching | Không có trong đề xuất, phát hiện khi đo lại | Claim 0,017 ms thay vì quét 56000 dòng; 5 và 6 chuyến/giây chuyển sang đạt | Đạt |
| A4 | Rate limit theo IP thật, chuyển IP xuống Driver | Không còn 429 cho người dùng hợp lệ | Header IP giả bị bỏ qua; mỗi IP một quota (kiểm trên stack thật) | Đạt |
| A6 | Dọn outbox sau 24 giờ | Tránh suy giảm khi chạy lâu | Lần chạy đầu xoá 75508 tin outbox Trip cũ; có index để dọn không quét bảng | Đạt |
| A7 | Log retry có mã lỗi; dependency bận thử lại tối đa 2 giây | Tìm được nguyên nhân chuyến chờ lâu | Chỉ ra 2459/2463 lần thử lại là `ROUTING_BUSY`, dẫn tới điểm nghẽn mới | Đạt |
| A8 | Rate limit Routing cho OSRM tự host theo năng lực đo được | Không còn `ROUTING_BUSY` ở tải bình thường | OSRM đo khoảng 1000 matrix/giây; cùng A7, p95 ở 6 chuyến/giây giảm từ 6,7 xuống 1,0 giây | Đạt |
| A9 | Edge tính theo số tài xế cao điểm | Edge không còn là điểm gãy đầu | 5000 tài xế, edge dùng 183 MiB trên 448 MiB được cấp | Đạt |
| E1 | Bộ đo chạy trong cụm | Đo được 3000–5000 tài xế | Đo được 5000 tài xế, môi trường không sập | Đạt |
| E2 | GPS 10 giây, kịch bản `/ws` | Bộ đo sát thực tế | Ở 8 chuyến/giây, request HTTP giảm từ 37372 xuống 3244 | Đạt |
| E3 | `pg_stat_statements` | Biết truy vấn nào nóng | Chỉ ra PostgreSQL bận vì số câu lệnh, không vì câu chậm | Đạt |

Tổng công sức thực tế cho nhóm A và E1–E3 nằm trong ước tính 6–7 ngày người, không thêm tài nguyên ngoài RAM edge.

### 3.1 Đã triển khai, chưa đo (2026-11-05)

B7 và B1 đã có code, test và smoke. Cột "Sau" mô tả theo code; kết quả đo lại cùng ngày nằm ở [báo cáo kiểm thử tải, mục 11](bao-cao-kiem-thu-tai.md#11-đo-lại-sau-b7-và-adr-0001-2026-11-05): mức đạt ngưỡng (giống app, 1000 tài xế) tăng từ 6 lên 12 chuyến/giây; ở 12 chuyến/giây tổng câu SQL giảm từ 2,1 triệu xuống 277 nghìn, CPU driver-api từ 0,82 xuống 0,07 core, PostgreSQL từ 1,05 xuống 0,27 core.

| ID | Trước | Sau | Kiểm chứng | Commit |
| --- | --- | --- | --- | --- |
| B7 — Trip | `active-drivers/batch` chạy 1 câu SQL mỗi tài xế (100 câu cho lô 100) | 1 câu `driver_id = ANY` cho cả lô | Test đơn vị Trip | `d48fe7c` |
| B7 — Driver | `eligibility/batch` khoá từng tài xế, khoảng 400 câu SQL và 200 lệnh Redis cho lô 100 | 2 câu SQL, 2 script Redis; ghi trạng thái có điều kiện thay cho advisory lock, tài xế đổi trạng thái giữa chừng trả `DRIVER_STATE_CHANGED` | Test đơn vị đếm số lần truy cập; test tích hợp trên PostgreSQL và Redis thật | `3cb0d8a` |
| B1 — expand | Routing hỏi Realtime, Realtime hỏi Driver, Driver hỏi Trip và Matching | Ba API mới: Realtime `driver-locations` (tối đa 200, `GEOSEARCH COUNT`), Driver `eligibility/candidates` (2 câu SQL, không khoá), Routing `eta-matrix` | Test từng service; candidates so khớp với eligibility đơn | `bcc8ecd`, `50f4f17`, `d6df2f9` |
| B1 — migrate | Matching gọi `/routes/matrix` rồi gọi Driver cho từng ứng viên | Matching gọi Realtime, Driver (theo lô 100), Routing (25 người gần nhất) mỗi service một lần | Test tích hợp trên PostgreSQL; smoke CAR_4 / CAR_7 xanh trên Docker với cả `direct` và `routing`, trên Kubernetes với `direct`; `restart-check.cjs` xanh | `80093e0` |

Ước tính mỗi lần tìm xe (theo code): câu SQL kiểm tra tài xế từ khoảng 1000 xuống khoảng 10; ETA tối đa 25 người thay vì 50; chi phí có trần ở 200 vị trí dù khu vực đông bao nhiêu. Sau khi đo, bước contract đã xoá đường cũ (`/routes/matrix`, `/nearby-drivers`, `eligibility/batch`, cờ `CANDIDATE_SOURCE`); smoke và `restart-check.cjs` xanh trên Kubernetes ([ADR-0001, mục Triển khai](adr/0001-matching-so-huu-tim-ung-vien.md#triển-khai)). Lưu ý: các số đo ở mục 11 của báo cáo tải chạy trước bước contract, khi `eligibility/batch` theo lô (B7) vẫn còn nhưng không nằm trên đường tìm xe.

### 3.2 B6 và A8, đo ngày 2026-11-10

Số đo đầy đủ ở [báo cáo kiểm thử tải, mục 12](bao-cao-kiem-thu-tai.md#12-đo-lại-với-observability-2026-11-10).

| ID | Đã làm | Kết quả đo được | Đánh giá |
| --- | --- | --- | --- |
| B6 | OpenTelemetry cho sáu service Node, metric riêng cho Matching, outbox Trip, Routing và GPS của Realtime; Collector, Jaeger, Prometheus, Grafana bật bằng `OBSERVABILITY=on` ([ADR-0003](adr/0003-observability-opentelemetry.md)) | Dashboard có dữ liệu thật; chỉ ra được bước nào chậm khi quá tải (bước lấy vị trí ở Realtime, độ trễ outbox) và xác nhận Routing không từ chối. Chi phí: CPU sáu service Node tăng khoảng 20% ở 6 chuyến/giây, 30–50% ở 20–24 chuyến/giây; vẫn đạt ngưỡng ở 24 chuyến/giây khi bật (mức cao nhất đã đo khi bật) | Đạt về chức năng; tắt khi đo trần thông lượng |
| A8 | Cho phép đổi giới hạn Routing và số luồng OSRM khi deploy; metric lý do từ chối | Không cần nới: 0 lần `ROUTING_BUSY` tới 32 chuyến/giây. Trần 16 chuyến/giây của lần đo 2026-11-05 là do pod Routing còn giữ giới hạn cũ (20000 phần tử ETA/phút) trong Secret; lỗi deploy này đã sửa ở `720fa49` | Đạt; `routingLimits` để trống |

Hệ quả cho các đề xuất còn lại:

- Mức đạt ngưỡng (giống app, 1000 tài xế, tắt observability) từ 12 lên ít nhất 32 chuyến/giây; chưa tìm thấy trần trên máy đo. PostgreSQL 0,63 core, không service nào quá 0,31 core trung bình ở 32 chuyến/giây.
- 5000 tài xế ở 8 chuyến/giây nay đạt (961/961, p95 0,9 giây, ack GPS p95 5 ms). Lần không đạt ngày 2026-11-05 không lặp lại; nguyên nhân lần đó chưa xác định.
- B4 (2 replica driver-api) và B3 chưa cần cho hiệu năng ở các mức đã đo; giữ vì tính sẵn sàng.
- Hai hiện tượng B6 cần giải thích (8–10 chuyến/giây kém hơn 12–16; đợt chậm khi chạy 30 phút): hiện tượng đầu đã hết từ B7 và ADR-0001; hiện tượng sau chưa đo lại, cần một lần chạy 30 phút có bật observability.

## 4. Ràng buộc chi phí

| Loại chi phí | Ràng buộc (theo [kiến trúc mục tiêu](kien-truc-muc-tieu.md#1-bối-cảnh-và-ràng-buộc)) |
| --- | --- |
| Công sức | 3 người (1 Java, 2 Node/TS), mỗi phase 2–3 tuần, đã có lịch Phase 1 và Phase 2 |
| Tài nguyên | Demo trên MacBook 16 GB, 10 core; VM Docker khoảng 7,7–8 GB; ngân sách sau Phase 2 khoảng 5,2 GB |
| Tiền | Không có ngân sách cloud thường xuyên; chỉ có thể thuê ngắn hạn cho một buổi đo |
| Công nghệ | Giữ PostgreSQL, Redis, RabbitMQ; chỉ thêm bộ observability |

Thứ tự ưu tiên vẫn là: sửa code nhỏ, rồi cấu hình, rồi tài nguyên. Số đo mới củng cố thứ tự này: ở trần hiện tại, nghẽn là số lần gọi, không phải CPU hay RAM của máy.

## 5. Đề xuất tiếp theo

### 5.1 Nhóm B: theo điểm nghẽn mới

Xếp theo thứ tự nên làm.

| ID | Cải tiến | Căn cứ đo được | Chỗ sửa | Công sức | Thêm tài nguyên | Hiệu quả ước tính |
| --- | --- | --- | --- | --- | --- | --- |
| B7 (mới) | **Đã triển khai 2026-11-05, chờ đo ([mục 3.1](#31-đã-triển-khai-chưa-đo-2026-11-05)).** Kiểm tra điều kiện tài xế theo lô thật sự. Driver đọc hồ sơ và xe của cả lô bằng một câu SQL (`WHERE id = ANY($1)`), đọc và ghi trạng thái Redis bằng một lệnh cho cả lô, bỏ advisory lock từng tài xế ở đường chỉ đọc. Trip trả lời `active-drivers/batch` bằng một câu SQL thay vì vòng lặp | Endpoint batch hiện lặp từng tài xế (4 song song): mỗi tài xế 4 câu SQL (đọc hồ sơ, đọc xe, lấy và trả advisory lock) và 2 lệnh Redis ở Driver, 1 câu SQL ở Trip. Ở 12 chuyến/giây: 363000 lần đọc hồ sơ, 363000 lần đọc xe, 727000 lệnh lock/unlock, 362000 câu hỏi chuyến đang mở trong 2,5 phút | `driver-service` batch eligibility use case và repository; `trip-service` controller `active-drivers/batch` | 1,5–2 ngày | Không | Câu SQL kiểm tra tài xế cho mỗi chuyến từ khoảng 1400 xuống khoảng 10–20; CPU driver-api và PostgreSQL ở 8 chuyến/giây giảm mạnh. Rủi ro trung bình: cần giữ đúng ngữ nghĩa khoá khi ghi trạng thái Redis |
| B1 | **Đã triển khai expand + migrate 2026-11-05, chờ đo ([mục 3.1](#31-đã-triển-khai-chưa-đo-2026-11-05)).** Matching tự lấy tối đa 200 vị trí, kiểm điều kiện theo lô, chỉ tính ETA cho 25 người gần nhất | Chi phí mỗi lần tìm tăng tuyến tính theo mật độ: từ 1000 lên 5000 tài xế, CPU driver-api tăng 3,5 lần, PostgreSQL 2,7 lần ở cùng tải | P1.1, [ADR-0001](adr/0001-matching-so-huu-tim-ung-vien.md) | Đã tính trong Phase 1 | Không | Chặn trên chi phí mỗi lần tìm; matrix 25 thay vì 50 element; cùng B7, mức đạt ngưỡng ước tính 10–12 chuyến/giây |
| B6 | **Đã triển khai 2026-11-10 cho sáu service Node ([mục 3.2](#32-b6-và-a8-đo-ngày-2026-11-10)); Gateway, User, Payment chưa làm.** Observability: metrics HTTP, event loop lag, thời gian chờ trong pool Routing, độ dài outbox, HikariCP; dashboard | Hai hiện tượng chưa giải thích được: thông lượng ở 8–10 chuyến/giây thấp hơn ở 12–16; đợt chậm 3 phút khi chạy 30 phút | P1.4, [ADR-0003](adr/0003-observability-opentelemetry.md) | Đã tính trong Phase 1 | khoảng 0,8 GB | Xác định được nguyên nhân hai hiện tượng trên; điều kiện để đo các bước sau |
| B5 | App tài xế làm mới token trước hạn và kết nối lại có jitter | Đợt chậm khi chạy lâu trùng với lúc 1000 tài xế cùng làm mới token; 2000 lần kết nối lại đúng lúc JWT hết hạn | Mới (app) | 1 ngày | Không | Tránh đợt làm mới và kết nối lại đồng loạt |
| B4 | 2 replica driver-api | driver-api là process nóng nhất (đỉnh 1,1–1,2 core ở 8–12 chuyến/giây). Phần chuyển IP thật cho Driver đã xong ở A4 | P2.5 | 0,5–1 ngày | khoảng 0,1 GB | Gấp đôi trần của driver-api; làm sau B7 vì B7 có thể đủ |
| B2 | Gộp đích `gateway` và `notification` của outbox Trip thành một đích trên RabbitMQ | Outbox Trip không còn là trần (offer → publish và accept → `ASSIGNED` đều dưới 0,3 giây); câu ghi `outbox_deliveries` vẫn nằm trong 5 câu tốn nhất của Trip | P1.3, [ADR-0002](adr/0002-truc-su-kien-rabbitmq.md) | Đã tính trong Phase 1 | Không | Giảm khoảng 40% tin outbox Trip; lợi ích hiệu năng nhỏ, lợi ích chính là không mất event khi Gateway tắt |
| B3 | 2 replica matching-worker | matching-worker dưới 0,15 core ở mọi mức đo | P2.5 | Đã tính trong Phase 2 | khoảng 0,08 GB | Không cần cho hiệu năng; giữ vì tính sẵn sàng |

### 5.2 Nhóm C: đắt hoặc để sau

| ID | Cải tiến | Khi nào cần | Chi phí |
| --- | --- | --- | --- |
| C1 | Nhiều replica cho trip-api, gateway-api, realtime-api (Socket.IO Redis adapter) | Khi B7, B1 đã xong mà một process chạm khoảng 1 core. Hiện ở cách đo giống app, Gateway, Trip và Realtime đều dưới 0,35 core | Mỗi replica Node khoảng 0,1 GB, JVM khoảng 0,5 GB; Realtime nhiều replica nằm trong P2.5 |
| C2 | PgBouncer, replica đọc PostgreSQL | Khi PostgreSQL vẫn là pod nóng nhất sau B7. Hiện nghẽn là số câu lệnh; PgBouncer không giảm chi phí mỗi câu | Thêm thành phần vận hành |
| C3 | Realtime lưu sẵn loại xe và trạng thái tài xế trong Redis để lọc tại chỗ (phương án ADR-0001 đã để sau) | Nếu B7 vẫn chưa đủ ở mật độ cao | Cần event từ Driver sang Realtime |
| C4 | Realtime đẩy offer kèm dữ liệu, bỏ một lời gọi HTTP mỗi offer | Đoạn publish → accept hiện p95 7–14 ms; chưa cần | Đổi contract event offer |
| C5 | Cụm production nhiều node, autoscaling | Khi cần khoảng 25 chuyến/giây hoặc có tải thật | Ngoài phạm vi đồ án |
| C6 (mới) | Cache hồ sơ tài xế và xe trong Redis (cache-aside, TTL ngắn, xoá khi ghi) | Khi đã làm B7 mà PostgreSQL vẫn là pod nóng nhất. B7 đã giảm câu SQL kiểm tra tài xế từ khoảng 1400 xuống khoảng 10–20 mỗi chuyến, nên cache chỉ còn lợi ích nhỏ | Phải xoá cache đúng lúc khi tài xế bị khoá hoặc đổi xe; thêm một nguồn dữ liệu có thể lệch với PostgreSQL |

### 5.3 Môi trường đo

| ID | Cải tiến | Trạng thái hoặc căn cứ | Công sức | Chi phí |
| --- | --- | --- | --- | --- |
| E1 | Bộ đo chạy trong cụm | **Đã làm.** Đo được 5000 tài xế | — | — |
| E2 | GPS 10 giây, kịch bản `/ws` | **Đã làm.** Mặc định của bộ đo | — | — |
| E3 | `pg_stat_statements` | **Đã làm.** Mỗi lần đo ghi `sql.json` | — | — |
| E4 | Thuê cụm thử nghiệm 1 ngày: 3 node ứng dụng khoảng 4 vCPU / 16 GB, 1 node PostgreSQL, 2 máy tạo tải | Một node local không tách được tranh chấp CPU giữa các service | khoảng 2 ngày người | Ước tính 6 máy × 8 giờ × 0,1–0,4 USD/giờ, tức khoảng 5–20 USD. **Cần kiểm tra bảng giá hiện tại** |
| E5 | Cấp VM Docker ít nhất 10 GB khi chạy observability cùng bài đo | Bài đo 5000 tài xế đã dùng thêm khoảng 0,4 GB cho pod tạo tải; B6 thêm khoảng 0,8 GB | 0 | Giảm RAM còn lại cho macOS |
| E6 (mới) | Chạy trọn kịch bản 3000 khách + 3500 tài xế trong cụm; mỗi mức tải đo ít nhất 3 lần | Kịch bản đợt mới chỉ ước tính; ở 8–10 chuyến/giây kết quả dao động 3,2–4,4 chuyến/giây giữa các lần | 1 ngày | 0 đồng |

### 5.4 Nhóm D: chịu lỗi và vận hành

Nhóm D không nâng thông lượng. Nhóm này giúp hệ thống trả lỗi nhanh khi một service hỏng, deploy không gián đoạn và khôi phục được dữ liệu. Các pattern đã có thì không đề xuất lại: chia service theo nghiệp vụ, Gateway xác thực JWT, event qua RabbitMQ và outbox, bulkhead ở Gateway (tối đa 256 request chờ cho mỗi service, Routing 128). Xếp theo thứ tự nên làm.

| ID | Cải tiến | Căn cứ | Chỗ sửa | Công sức | Thêm tài nguyên | Hiệu quả và cách chứng minh |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | Circuit breaker và ngân sách thử lại cho client HTTP giữa các service Node. Breaker đếm lỗi `TIMEOUT`, `UNREACHABLE` và 5xx; sau vài lỗi liên tiếp thì trả lỗi ngay, vài giây sau mới cho một request thử. Lỗi bận có `Retry-After` vẫn đi theo cơ chế của A7, nhưng tổng số lần thử lại có giới hạn | Ở 8 chuyến/giây trở lên, 2459/2463 lần thử lại là `ROUTING_BUSY` (A7); mỗi lần thử lại vẫn gửi vào Routing đang quá tải. Gateway có bulkhead, còn các lời gọi giữa service Node chỉ có timeout | Một module client dùng chung cho `matching-service` (`infrastructure/clients.ts`), client Routing của Trip, client của Realtime và Driver; nằm trong P2.5 | 1–1,5 ngày | Không | Khi Routing tắt hoặc hỏng, báo giá và tìm xe trả lỗi trong vài ms thay vì chờ hết timeout. Chứng minh: scale Routing về 0 trong lúc đo, ghi p95 của lỗi báo giá và thời gian hồi phục sau khi bật lại; đo lại loạt 2 để chắc breaker không mở oan ở tải cao |
| D2 | Rolling update cho service không giữ dữ liệu: `RollingUpdate`, `maxUnavailable: 0`, `maxSurge: 1`. Giữ `Recreate` cho PostgreSQL, Redis, RabbitMQ vì PVC `ReadWriteOnce` không gắn được vào hai pod | Mọi Deployment đang sinh ra với `strategy: Recreate` và 1 replica ([generate.cjs](../deploy/generate.cjs)), nên mỗi lần deploy service dừng tới khi pod mới sẵn sàng. Readiness probe, startup probe, xử lý `SIGTERM` và `terminationGracePeriodSeconds: 60` đã có | `deploy/generate.cjs` | 0,5 ngày | Chỉ trong lúc deploy: thêm một pod (Node khoảng 0,1 GB, JVM khoảng 0,5 GB) | Deploy không gián đoạn request HTTP. Chứng minh: chạy 2 chuyến/giây trong lúc `kubectl rollout restart` từng service, lỗi HTTP 0%. Kết nối WebSocket trên pod cũ vẫn bị ngắt và app phải nối lại; cần B5 để không nối lại đồng loạt |
| D3 | Đặt RPO/RTO và diễn tập sao lưu, khôi phục. Mục tiêu cho demo: PostgreSQL RPO 1 giờ (CronJob `pg_dump` mỗi giờ ra volume riêng, giữ 24 bản), RTO 15 phút | [Báo cáo demo Kubernetes](bao-cao-demo-kubernetes.md) ghi "Chưa diễn tập backup/restore"; chưa tài liệu nào nêu RPO/RTO | `deploy/generate.cjs` (CronJob, PVC sao lưu), mục mới trong [deploy-backend.md](deploy-backend.md) | 1 ngày | Đĩa khoảng 24 lần kích thước dump | Có số RTO đo được thay vì giả định. Chứng minh: dựng PostgreSQL trống, khôi phục từ bản dump, đo thời gian tới khi smoke test qua. Kiểm thêm hai điều: khôi phục bản cũ sẽ gửi lại event outbox đã gửi sau thời điểm dump, consumer phải bỏ qua nhờ idempotent theo `eventId`; mất Redis thì tài xế có phải bật lại trạng thái online không |
| D4 | Viết rõ luồng chuyến đi là một saga kiểu choreography: sơ đồ trạng thái Trip và bảng mỗi bước gồm service, event, lỗi có thể xảy ra, hành động bù trừ | Luồng đặt xe → tìm xe → offer → nhận → hoàn thành hoặc huỷ đã chạy qua outbox và event ([kiến trúc mục tiêu, mục 7](kien-truc-muc-tieu.md#7-danh-mục-sự-kiện)), nhưng chưa tài liệu nào gọi tên saga hay liệt kê bù trừ. Kiến trúc mục tiêu đã loại Temporal vì saga ngắn | Tài liệu, không sửa code | 0,5 ngày | Không | Trả lời được câu hỏi về nhất quán dữ liệu giữa các service; phát hiện bước chưa có bù trừ. Ví dụ bù trừ đã có: hết hạn tìm xe thành `NO_DRIVER_FOUND` ([ADR-0004](adr/0004-gioi-han-thoi-gian-tim-xe.md)), offer hết `expires_at` thì tìm tài xế khác (A3). Phase 2: huỷ sau khi giữ tiền thì nhả tiền ([ADR-0005](adr/0005-payment-so-cai-kep-tcc.md)) |

## 6. Đối chiếu với ADR

| ADR | Trạng thái đề xuất | Căn cứ từ lần đo 2026-11-04 | Cần đo khi triển khai |
| --- | --- | --- | --- |
| [0008](adr/0008-xu-ly-hang-doi-lien-tuc.md) Xử lý hàng đợi liên tục | **Đã chấp nhận 2026-11-05** | Đã triển khai và đạt cả hai tiêu chí đo lại: p95 ≤ 10 giây ở 4 chuyến/giây (đo được 0,9 giây), offer → publish ≤ 200 ms (12 ms). Bổ sung partial index outbox Matching | Giữ trong bộ đo hồi quy |
| [0001](adr/0001-matching-so-huu-tim-ung-vien.md) Matching tự tìm ứng viên | **Đã chấp nhận 2026-11-05**, đã triển khai đủ 3 bước ([báo cáo tải, mục 11](bao-cao-kiem-thu-tai.md#11-đo-lại-sau-b7-và-adr-0001-2026-11-05)) | Bước tìm và kiểm tra tài xế là điểm nghẽn mới. Bổ sung cho ADR: endpoint batch phải truy vấn theo lô (B7), nếu không, giới hạn 200 ứng viên vẫn tốn khoảng 1000 câu SQL mỗi lần tìm | Câu SQL mỗi chuyến; CPU driver-api và PostgreSQL ở 8–12 chuyến/giây |
| [0003](adr/0003-observability-opentelemetry.md) Observability | Nên làm cùng 0001 | Hai hiện tượng chưa giải thích được vì thiếu metrics phía server; bổ sung exporter cho `pg_stat_statements` (E3 đã bật) | RAM thật của bộ observability |
| [0002](adr/0002-truc-su-kien-rabbitmq.md) Trục sự kiện RabbitMQ | Không còn gấp về hiệu năng | Outbox Trip không còn là trần sau A1 | Thời gian publish và confirm |
| [0004](adr/0004-gioi-han-thoi-gian-tim-xe.md) Giới hạn thời gian tìm xe | Không đổi | Với thông lượng mới, số chuyến bị huỷ `NO_DRIVER_FOUND` trong đợt đột biến giảm mạnh ([mục 8](#8-kỳ-vọng-cho-kịch-bản-3000-khách)) | Số chuyến `NO_DRIVER_FOUND` trong kịch bản đợt |
| [0005](adr/0005-payment-so-cai-kep-tcc.md), [0006](adr/0006-gia-dong-theo-o-h3.md), [0007](adr/0007-admin-web-va-role-admin.md) | Không đổi | Không nằm trên đường nóng đo được; báo giá hiện p95 13–66 ms khi chưa quá tải | p95 `POST /trips` và báo giá trước và sau khi thêm |

## 7. Lộ trình đề xuất

| Thời điểm | Việc | Đo lại bằng | Mục tiêu (ước tính, cần xác nhận) |
| --- | --- | --- | --- |
| Đã xong | Nhóm A, index outbox Matching, E1–E3 | 21 lần đo ngày 2026-11-04 | Đạt: 6 chuyến/giây trong ngưỡng, 5000 tài xế |
| Ngay, 1 tuần | B7 (code xong 2026-11-05); ADR-0008 đã chấp nhận 2026-11-05 | Loạt 2 (giống app) ở 6, 8, 10, 12 chuyến/giây; `sql.json` | Câu SQL kiểm tra tài xế dưới 20 mỗi chuyến; đạt ngưỡng ở 10 chuyến/giây |
| Phase 1 | B1 (xong cả contract và đo 2026-11-05: đạt 12 chuyến/giây), B6 (sáu service Node xong và đo 2026-11-10; phần Java còn lại) (P1.1, P1.4); B2 nếu còn thời gian | Như trên với 2000 và 5000 tài xế; dashboard | Trần không giảm khi tăng từ 1000 lên 5000 tài xế; giải thích được hai hiện tượng còn mở |
| Phase 2 | B5, B4, B3, D1 (cùng P2.5) | Tài xế lên ca đồng loạt; chạy lâu 2 giờ; tắt Routing trong lúc đo | Không có đợt chậm khi làm mới token; RAM ổn định; báo giá trả lỗi ngay khi Routing tắt |
| Trước bảo vệ | E6, D2, D3, D4; tuỳ chọn E4 | Kịch bản 3500 tài xế + 3000 chuyến; deploy trong lúc chạy tải; diễn tập khôi phục | Ghi lại thời gian gán hết 3000 chuyến; 0% lỗi HTTP khi deploy; RTO đo được |

Mỗi cải tiến chạy lại đúng kịch bản trước đó, so trong một bảng trước/sau và chỉ đổi một thay đổi mỗi lần ([kế hoạch, giai đoạn 9](ke-hoach-kiem-thu-hieu-nang.md#giai-đoạn-9-tối-ưu-và-đo-lại)).

## 8. Kỳ vọng cho kịch bản 3000 khách

| Trạng thái | Thông lượng gán | Gán hết 3000 chuyến | Được gán trong 3 phút nếu có ADR-0004 |
| --- | --- | --- | --- |
| Mốc ban đầu (đo) | khoảng 2,5–3 chuyến/giây | 15–20 phút | khoảng 450–540 |
| Hiện tại, sau nhóm A (đo thông lượng, ước tính kịch bản) | khoảng 6 trong ngưỡng, tối đa khoảng 10 chuyến/giây | khoảng 5–8 phút | khoảng 1100–1800 |
| Sau B7 + B1 (ước tính) | khoảng 12–15 chuyến/giây | khoảng 3–4 phút | khoảng 2200–2700 |
| 3000 chuyến trong khoảng 2 phút | khoảng 25 chuyến/giây | Cần thêm C1 và nhiều máy (C5); ngoài phạm vi demo | 3000 |

Với hạn tìm xe 3 phút ([ADR-0004](adr/0004-gioi-han-thoi-gian-tim-xe.md)), số chuyến được gán xấp xỉ bằng thông lượng × 180 giây, nên nâng thông lượng quyết định trực tiếp số khách được phục vụ trong một đợt đột biến.

## 9. Nối điểm nghẽn với cải tiến

| Điểm nghẽn trong [báo cáo](bao-cao-kiem-thu-tai.md#7-phân-tích-điểm-nghẽn-hiện-tại) | Cải tiến | Trạng thái |
| --- | --- | --- |
| Hai hàng đợi outbox và nhịp worker giới hạn khoảng 3 chuyến/giây (mốc ban đầu) | A1, A2, A3, A5, index outbox Matching | Đã xử lý |
| Rate limit đăng nhập tính theo IP của proxy | A4 | Đã xử lý |
| Edge nginx chưa cấu hình cho nhiều WebSocket | A9 | Đã xử lý |
| Rate limit Routing mặc định | A8 | Đã xử lý |
| Lỗi matching bị nuốt, backoff tới 30 giây | A7 | Đã xử lý |
| Môi trường đo: port-forward, `cri-dockerd` | E1 | Đã xử lý |
| driver-api kiểm tra từng tài xế một ([7.1](bao-cao-kiem-thu-tai.md#71-driver-api-kiểm-tra-từng-tài-xế-một)) | B7, B1, B4 | Đề xuất |
| PostgreSQL bận vì số câu lệnh ([7.2](bao-cao-kiem-thu-tai.md#72-postgresql-bận-vì-số-câu-lệnh)) | B7, B1; sau đó C2 nếu cần | Đề xuất |
| Poll khuếch đại tải khi chờ lâu ([7.3](bao-cao-kiem-thu-tai.md#73-poll-khuếch-đại-tải-khi-khách-chờ-lâu)) | App đã dùng `/ws`; bộ đo E2 | Đã xử lý ở bộ đo |
| Đợt chậm khi chạy lâu ([7.4](bao-cao-kiem-thu-tai.md#74-đợt-chậm-khi-chạy-lâu)) | B6 để tìm nguyên nhân; B5 | Đề xuất |
| Thông lượng không đơn điệu ở 8–10 chuyến/giây | B6, E6 | Cần đo thêm |
| Thử lại dồn vào Routing khi quá tải (2459 lần `ROUTING_BUSY`) | B7 bỏ nguyên nhân; D1 chặn thử lại khi dependency hỏng | Đề xuất |
| Một bước HTTP cho mỗi offer | C4 | Chưa cần |

## 10. Không đề xuất

| Không làm | Lý do |
| --- | --- |
| Tăng `WORKER_POOL_SIZE` của Routing | Đã thử 8 thay vì 2 ở 8 chuyến/giây: không cải thiện (3,95 so với 3,2–4,4 chuyến/giây được gán). Routing chờ driver-api phía sau |
| Tăng CPU/RAM cho PostgreSQL, thêm index | Không có câu lệnh chậm (0,001–0,07 ms mỗi câu); CPU là chi phí theo số câu lệnh |
| Kafka, thay RabbitMQ | Hàng đợi không còn là điểm nghẽn; kiến trúc mục tiêu đã loại vì tốn RAM |
| Batch matching, geo-sharding, service mesh | Đã nằm trong mục không làm của kiến trúc mục tiêu; chưa phải nghẽn |
| Cache báo giá | Báo giá p95 13–66 ms khi chưa quá tải; chỉ chậm khi các service khác đã quá tải |
| BFF riêng cho app khách và app tài xế | [ADR-0007](adr/0007-admin-web-va-role-admin.md) đã cân nhắc và loại. Hai app dùng chung phần lớn API; BFF thêm một bước mạng trên đường nóng. Nếu cần API riêng, tách nhóm route trong Gateway |
| Memcached cạnh Redis | Redis đã dùng cho vị trí, rate limit và event inbox; thêm một hệ cache là thêm thành phần vận hành mà không giải nghẽn nào đã đo |
| Autoscaling (HPA) trên Docker Desktop một node | Mọi pod dùng chung CPU của một máy; HPA thêm pod nhưng không thêm năng lực, nên không chứng minh được gì. Để ở C5 |
| Blue-green deployment | Cần gấp đôi RAM trong lúc chuyển; máy 16 GB không đủ khi chạy cùng observability. Rolling update (D2) đủ để deploy không gián đoạn |

## 11. Giả định và việc cần xác minh

1. Ước tính công sức tính cho người đã quen code của service đó, chưa gồm thời gian review.
2. Hiệu quả của B7 phụ thuộc việc giữ đúng ngữ nghĩa khoá khi Driver ghi trạng thái tài xế vào Redis; cần review cùng người viết Driver trước khi bỏ advisory lock.
3. Mức "10–12 chuyến/giây sau B7 + B1" suy ra từ việc driver-api và PostgreSQL là hai pod nóng nhất, các pod còn lại dưới 0,35 core; nghẽn tiếp theo có thể là Realtime hoặc một node CPU dùng chung.
4. Giá cloud ở E4 là khoảng tham khảo; cần kiểm tra bảng giá hiện tại và hạn mức tài khoản sinh viên nếu có.
5. Năng lực OSRM triển khai thật cần đo lại với số thread và CPU của nó (A8 đo trên local); số tài xế cao điểm cho edge (A9) cần chốt với tải mục tiêu.
6. Tải mục tiêu (số tài xế, số chuyến giờ cao điểm) chưa được chốt ([kế hoạch, mục 10](ke-hoach-kiem-thu-hieu-nang.md#10-giả-định-và-việc-cần-xác-minh-trước-khi-chạy-ở-môi-trường-thật)). Nếu mục tiêu chỉ là demo trước hội đồng, trạng thái hiện tại (6 chuyến/giây, 5000 tài xế) đã đủ; B7 là bước rẻ nhất để có thêm dư địa.
7. Ngưỡng của breaker ở D1 (số lỗi liên tiếp, thời gian mở) cần chọn theo số đo loạt 2 sau B7; chọn trước khi đo có thể làm breaker mở oan ở tải cao.
8. RPO 1 giờ và RTO 15 phút ở D3 là mục tiêu cho demo, cần chốt với yêu cầu nghiệp vụ. Khi có Payment, sổ cái cần RPO gần 0 (WAL archiving, khôi phục theo thời điểm), ngoài phạm vi demo.
