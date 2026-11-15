# Tổng hợp cải tiến hiệu năng trên nhánh perf/adr-0008-trip-outbox

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Toàn hệ thống |
| Rà soát | 2026-11-15 |
| Quy ước | [Format và số liệu](quy-uoc-tai-lieu.md) |

Tài liệu cho các thành viên cần quyết định có merge nhánh `perf/adr-0008-trip-outbox` vào `main` hay không. Nó tóm tắt nhánh này đổi gì so với `main`, vì sao, đo được gì, phải đánh đổi gì và merge thì cần lưu ý gì. Chi tiết từng phần nằm ở [báo cáo kiểm thử tải](bao-cao-kiem-thu-tai.md), [đề xuất cải tiến hiệu năng](de-xuat-cai-tien-hieu-nang.md) và các [ADR](adr/README.md).

## 1. Tóm tắt

- **Vấn đề:** trên `main`, hệ thống chỉ chịu được khoảng 2 lượt đặt chuyến mỗi giây với 1000 tài xế online. Ở 4 chuyến/giây khách chờ gần 50 giây mới có tài xế; ở 8 chuyến/giây phần lớn chuyến không được gán.
- **Kết quả:** trên nhánh này, mức cao nhất đã đo là 32 chuyến/giây và vẫn trong ngưỡng: 3841/3841 chuyến được gán, 95% chuyến có tài xế trong 1,1 giây. 5000 tài xế online chạy ổn định.
- **Cách làm:** không thêm máy, không thêm replica. Các thay đổi đều là bỏ việc thừa: hàng đợi không còn nghỉ khi đang có việc, và mỗi lần tìm xe dùng khoảng 10 câu SQL thay vì khoảng 1000.
- **Quy mô:** 46 commit, 213 file, khoảng +12000 / −1700 dòng. Khoảng một phần ba là bộ đo tải và tài liệu.
- **Hành vi với app không đổi.** API public qua Gateway giữ nguyên. Ba API nội bộ giữa các service bị thay bằng ba API mới ([mục 5](#5-thay-đổi-cần-biết-trước-khi-merge)).
- **Merge:** có 2 file xung đột thật với `main` hiện tại (sau PR #5), cách xử lý ở [mục 7](#7-xung-đột-với-main). Nhánh chưa mở pull request: chủ nhánh sẽ đo lại "trước" trên `main` và "sau" trên nhánh này rồi mới đề nghị merge.

## 2. Vấn đề ban đầu

Đo ngày 2026-10-28/29 trên `main` (một MacBook, Kubernetes local, 1000 tài xế giả lập):

| Mức tải | Kết quả trên `main` |
| --- | --- |
| 2 chuyến/giây | Đạt; 95% chuyến có tài xế trong 4,0 giây |
| 4 chuyến/giây | p95 48 giây, hàng đợi dài dần |
| 8 chuyến/giây | 110 chuyến được gán, 422 chuyến chờ quá 60 giây, lỗi HTTP 3,9% |
| 5000 tài xế | Không đo được, môi trường đo sập ở khoảng 3500 kết nối |

CPU và RAM khi đó còn thừa. Hệ thống chậm vì cách xử lý, không vì thiếu tài nguyên. Có ba nguyên nhân, tìm ra lần lượt qua từng vòng đo:

1. **Hàng đợi tự nghỉ.** Outbox của Trip, publisher và worker của Matching xử lý một lô rồi nghỉ một nhịp cố định, kể cả khi còn việc đang chờ.
2. **Kiểm tra tài xế từng người một.** Mỗi lần tìm xe, Driver kiểm tra điều kiện từng ứng viên bằng nhiều câu SQL và khoá riêng: khoảng 1000 câu SQL cho một lần tìm.
3. **Chuỗi gọi dài.** Matching hỏi Routing, Routing hỏi Realtime, Realtime hỏi Driver, Driver hỏi lại Trip và Matching. Chi phí tăng theo số tài xế trong khu vực.

## 3. Các cải tiến, theo thứ tự làm

Mỗi bước đều theo một vòng: đo, tìm điểm nghẽn lớn nhất, sửa đúng chỗ đó, đo lại bằng cùng kịch bản.

### 3.1 Bộ đo tải (E1–E3)

Trước khi sửa cần đo được. `main` không có công cụ đo tải.

| Thay đổi | Để làm gì |
| --- | --- |
| Bộ đo [deploy/load](../deploy/load/README.md): giả lập tài xế, khách đặt chuyến bằng k6, ghi CPU/RAM từng pod | Mọi con số trong tài liệu này lấy từ đây |
| E1: bộ đo chạy bên trong cụm | Đo được 5000 tài xế; trước đó `kubectl port-forward` gãy trước hệ thống |
| E2: khách chờ kết quả qua WebSocket, GPS mỗi 10 giây | Giống app thật; cách đo cũ (poll 300 ms) tự tạo thêm tải |
| E3: ghi thời gian từng câu SQL (`pg_stat_statements`) | Biết PostgreSQL bận vì câu nào |

### 3.2 Hàng đợi chạy liên tục (ADR-0008: A1, A2, A3, A5)

| Trước | Sau |
| --- | --- |
| Outbox Trip gửi tối đa một lô rồi nghỉ, dù còn tin chờ | Lô đầy thì chạy tiếp ngay; chỉ nghỉ 250 ms khi hết việc |
| Matching gửi tối đa 10 offer mỗi nhịp, chung vòng với việc khác | Vòng gửi riêng, được đánh thức ngay khi có offer |
| Worker Matching chạy theo đợt, một job chậm giữ cả đợt | Pool 16 job, xong job nào nhận job mới ngay |
| Câu lấy offer chờ gửi quét cả bảng (56000 dòng) | Có index riêng cho dòng chưa gửi: 0,017 ms |

Kết quả ở 4 chuyến/giây: tìm thấy tài xế → gửi offer từ p95 8 giây xuống 12 ms; tài xế nhận → chuyến `ASSIGNED` từ 7,0 xuống 0,3 giây. Quyết định ghi ở [ADR-0008](adr/0008-xu-ly-hang-doi-lien-tuc.md).

### 3.3 Sửa nhỏ quanh luồng chính (A4, A6, A7, A8, A9)

| ID | Thay đổi | Vì sao |
| --- | --- | --- |
| A4 | Gateway giới hạn đăng nhập theo IP thật của người dùng | Trước đó mọi người dùng chung một quota vì đều đi qua một proxy |
| A6 | Xoá tin outbox đã gửi sau 24 giờ | Bảng outbox lớn dần làm hệ thống chậm khi chạy lâu; lần chạy đầu xoá 75508 tin cũ |
| A7 | Log lý do mỗi lần tìm xe phải thử lại; service bận thì thử lại sớm | Nhờ log này mới thấy gần hết lần thử lại là do Routing từ chối |
| A8 | Giới hạn tốc độ của Routing tính theo năng lực đo được của OSRM tự host | Giới hạn cũ đặt cho dịch vụ bản đồ bên ngoài, quá thấp cho OSRM chạy tại chỗ |
| A9 | Nginx ở edge được cấp kết nối và RAM theo số tài xế cao điểm | Edge là chỗ gãy đầu tiên khi tăng số tài xế |

Sau nhóm này và 3.2, mức đạt ngưỡng tăng từ 2 lên 6 chuyến/giây (đo 2026-11-04).

### 3.4 Kiểm tra tài xế theo lô (B7)

Điểm nghẽn tiếp theo: driver-api chạm 1 core, PostgreSQL chạy khoảng 14000 câu lệnh mỗi giây.

| Service | Trước | Sau |
| --- | --- | --- |
| Driver | Kiểm tra lô 100 tài xế: khoảng 400 câu SQL và 200 lệnh Redis, khoá từng người | 2 câu SQL và 2 script Redis cho cả lô, không khoá ở đường chỉ đọc |
| Trip | "Tài xế nào đang có chuyến": 1 câu SQL mỗi tài xế | 1 câu cho cả lô |

### 3.5 Matching tự tìm ứng viên (ADR-0001)

Thay chuỗi gọi dài bằng ba lần gọi do Matching tự điều phối, mỗi service một lần:

```text
Trước:  Matching → Routing → Realtime → Driver → Trip, Matching
Sau:    Matching → Realtime  (tối đa 200 vị trí gần nhất)
        Matching → Driver    (kiểm điều kiện theo lô 100)
        Matching → Routing   (ETA cho 25 người gần nhất)
```

Làm theo ba bước để lúc nào cũng quay lại được: thêm API mới (expand), chuyển Matching sang dùng (migrate), đo xong mới xoá đường cũ (contract). Chi phí một lần tìm nay có trần cố định dù khu vực đông bao nhiêu: tổng câu SQL ở 4 chuyến/giây bằng nhau với 2000 và 5000 tài xế. Quyết định ghi ở [ADR-0001](adr/0001-matching-so-huu-tim-ung-vien.md).

Sau 3.4 và 3.5, mức đạt ngưỡng tăng từ 6 lên 12 chuyến/giây (đo 2026-11-05); tổng câu SQL ở 12 chuyến/giây giảm từ 2,1 triệu xuống 277 nghìn.

### 3.6 Đo đạc bên trong service (B6, ADR-0003)

Tới đây bộ đo bên ngoài không còn đủ: biết là chậm nhưng không biết chậm ở bước nào. Nhánh thêm OpenTelemetry cho sáu service Node (Trip, Matching, Driver, Realtime, Price, Routing):

- **Metric:** thời gian và lỗi của mọi request, thời gian từng bước tìm xe, độ trễ outbox, lý do Routing từ chối, thời gian xử lý GPS, độ bận của event loop.
- **Trace:** xem một request đi qua những service nào, mất bao lâu ở mỗi nơi.
- **Công cụ:** Grafana (dashboard dựng sẵn), Jaeger, Prometheus; bật bằng `OBSERVABILITY=on` khi deploy, [hướng dẫn](deploy-backend.md#observability-tuỳ-chọn).

Mặc định **tắt**. Khi tắt, service không nạp gói OpenTelemetry nào và manifest deploy giống hệt trước.

### 3.7 Sửa công cụ deploy

- `kube-up` nay thay hẳn Secret của từng service. Trước đó, biến môi trường đã bỏ khỏi cấu hình vẫn còn trong pod. Lỗi này từng làm sai một kết quả đo ([mục 4](#4-kết-quả-đo)).
- Mỗi Deployment mang mã băm của cấu hình, đổi cấu hình là pod tự khởi động lại.
- Giới hạn của Routing và số luồng OSRM đổi được bằng biến môi trường khi deploy, để thử nghiệm không cần sửa code.

### 3.8 Trả lỗi nhanh khi một service hỏng (D1)

Thêm sau lần đo cuối, **chưa đo**. Không nhằm tăng thông lượng.

- **Circuit breaker:** client HTTP giữa các service Node (Matching, Trip, Driver, Realtime) đếm lỗi của từng service đích. 5 lỗi liên tiếp (timeout, không kết nối được, 5xx không có `Retry-After`) thì ngừng gọi service đó trong 5 giây và trả lỗi ngay; hết 5 giây cho một request thử, thành công thì gọi lại bình thường.
- **Ngân sách thử lại:** lần thử lại sớm của Matching khi service bận (A7) bị giới hạn ở 20% số job trong 10 giây gần nhất; vượt mức thì lùi theo hàm mũ như lỗi khác.
- Trả lời 4xx, 429 và 503 có `Retry-After` không làm ngừng gọi, vì service đích vẫn đang trả lời. Mã lỗi trả cho app không đổi.

## 4. Kết quả đo

Cùng một máy, 1000 tài xế, mỗi mức chạy 2 phút. "Đạt" nghĩa là đồng thời: tạo chuyến → có tài xế p95 ≤ 10 giây, báo giá p95 ≤ 300 ms, ack GPS p95 ≤ 200 ms, lỗi HTTP < 0,5%.

| Thời điểm | Trạng thái code | Mức cao nhất đạt ngưỡng | p95 tới khi có tài xế ở mức đó |
| --- | --- | --- | --- |
| 2026-10-29 | `main` | 2 chuyến/giây | 4,0 giây |
| 2026-11-04 | Sau 3.1–3.3 | 6 chuyến/giây | 1,0 giây |
| 2026-11-05 | Sau 3.4–3.5 | 12 chuyến/giây | 0,9 giây |
| 2026-11-10 | Toàn bộ nhánh, tắt observability | **32 chuyến/giây** (mức cao nhất đã đo) | **1,1 giây** |
| 2026-11-10 | Toàn bộ nhánh, bật observability | 24 chuyến/giây (mức cao nhất đã đo khi bật) | 1,3 giây |

Cần đọc bảng này cùng ba lưu ý:

1. **Dòng đầu đo bằng cách đo cũ** (qua port-forward, GPS 3 giây, khách poll); các dòng sau đo bằng cách giống app. Phép so cùng cách đo bắt đầu từ dòng 2026-11-04. Chủ nhánh sẽ đo lại `main` bằng bộ đo mới để có phép so sạch.
2. **Từ 12 lên 32 không phải nhờ cải tiến mới.** Ngày 2026-11-05, 16 chuyến/giây không đạt vì pod Routing còn giữ giới hạn cũ (lỗi deploy ở mục 3.7): 16 chuyến × 25 ETA × 60 giây = 24000 phần tử mỗi phút, vượt giới hạn cũ 20000. Sau khi sửa deploy, giới hạn của A8 mới thật sự có hiệu lực. Đây là suy luận từ lịch sử code và phép tính, chưa tái hiện lại.
3. **Chưa tìm thấy trần.** Ở 32 chuyến/giây PostgreSQL dùng 0,63 core, không service nào quá 0,31 core. Chưa đo cao hơn.

Số liệu khác:

| Phép đo | `main` | Nhánh này |
| --- | --- | --- |
| 5000 tài xế online, 8 chuyến/giây | Không đo được | 961/961 chuyến, p95 0,9 giây, 80627/80627 bản tin GPS được ack |
| Tổng câu SQL trong 2 phút ở 12 chuyến/giây | 2,1 triệu (đo 2026-11-04, trước B7) | 277 nghìn |
| Chạy liên tục 30 phút ở 3 chuyến/giây (đo 2026-11-04) | Chưa đo | 5388/5395 chuyến, RAM ổn định, có một đợt chậm 3 phút chưa giải thích |

## 5. Thay đổi cần biết trước khi merge

| Loại | Thay đổi | Ảnh hưởng |
| --- | --- | --- |
| API nội bộ bị xoá | Routing `/routes/matrix`; Realtime `/nearby-drivers`; Driver `eligibility/batch`; biến `CANDIDATE_SOURCE` | Chỉ Matching dùng và đã chuyển sang API mới. Code khác gọi ba API này sẽ hỏng; trong repo không còn nơi nào gọi |
| API nội bộ mới | Realtime `driver-locations`; Driver `eligibility/candidates`; Routing `eta-matrix` | Matching cần token gọi Realtime; generator đã sinh sẵn |
| Database | Trip: một migration thêm index cho việc dọn outbox. Matching: index cho dòng outbox chưa gửi | Chỉ thêm index, không đổi cột; migration chạy trong `kube-up` như cũ |
| Dữ liệu | Tin outbox đã gửi bị xoá sau 24 giờ | Ai đang dùng bảng outbox làm lịch sử sẽ mất dữ liệu cũ hơn 24 giờ |
| Hành vi Driver | Kiểm tra theo lô không còn khoá từng tài xế; tài xế đổi trạng thái giữa chừng trả `DRIVER_STATE_CHANGED` | Matching bỏ qua ứng viên đó và tìm tiếp |
| Gateway | Giới hạn đăng nhập theo IP thật; header IP do client tự gửi bị bỏ qua | Gateway chỉ tin header IP từ proxy nội bộ (nginx ở edge ghi đè header); thêm biến `DRIVER_PROXY_TOKEN`, generator đã sinh sẵn |
| Thư viện | Sáu service Node thêm các gói `@opentelemetry/*` | Image lớn hơn; không nạp khi tắt observability |
| Deploy | `kube-up` thay Secret và khởi động lại pod khi cấu hình đổi; thêm thư mục `deploy/load` và `deploy/observability` | Lần `kube-up` đầu sau merge sẽ khởi động lại mọi pod |

API public qua Gateway, app Android và web không đổi.

## 6. Đánh đổi và việc chưa làm

**Đánh đổi đã chấp nhận**

- Matching phụ thuộc trực tiếp vào ba service (Realtime, Driver, Routing) thay vì một. Đổi lại mỗi service chỉ làm một việc và chuỗi gọi ngắn hơn.
- Mỗi lần tìm chỉ xét 200 tài xế gần nhất và tính ETA cho 25 người. Ở khu vực rất đông, tài xế thứ 201 không được xét.
- Kiểm tra điều kiện không khoá nên có thể dùng trạng thái cũ vài mili giây; bước gán chuyến vẫn kiểm tra lại từng tài xế, và ghi trạng thái có điều kiện nên không gán trùng.
- Observability tốn CPU: các service Node tăng 20–50% khi bật. Vì vậy để mặc định tắt và tắt khi đo trần thông lượng.

**Chưa làm hoặc chưa chắc**

- Gateway, User, Payment (Java) chưa có observability.
- Một chuyến hiện là ba đoạn trace, chưa phải một trace liền từ đầu tới cuối.
- Chưa tìm thấy trần thông lượng; chưa đo trên 32 chuyến/giây.
- Mỗi mức tải mới đo một lần, 2 phút, trên một laptop. Hai lần đo cùng mức có thể lệch đáng kể (ví dụ p95 2,0 và 1,5 giây).
- Lần 5000 tài xế ở 8 chuyến/giây không đạt ngày 2026-11-05 nay đạt, nhưng chưa xác định được vì sao hôm đó không đạt.
- Đợt chậm 3 phút khi chạy 30 phút chưa được đo lại.
- Observability mới kiểm chứng trên Kubernetes; phía Docker Compose mới có test sinh cấu hình.
- D1 (circuit breaker) chưa đo: cần tắt Routing giữa lúc đo để xem báo giá lỗi nhanh và hồi phục, và đo lại ở tải cao để chắc breaker không ngừng gọi nhầm.
- Chưa có nhiều replica cho service nào; đây là việc của tính sẵn sàng, chưa cần cho hiệu năng ở các mức đã đo.

## 7. Xung đột với main

Thử merge với `main` hiện tại (`94d0999`, sau PR #5) bằng `git merge-tree`, không thay đổi nhánh nào. Năm file cùng bị sửa ở hai bên; ba file tự merge được (`docs/deploy-backend.md`, `docs/deploy.md`, `service/driver-service/docs/api.md`), hai file xung đột:

| File | `main` đổi gì | Nhánh đổi gì | Cách xử lý |
| --- | --- | --- | --- |
| `deploy/run.cjs` | Tách port-forward ra `deploy/port-forward.cjs` (`ensurePortForward`), thêm lệnh `kube-forward` | Thêm apply / gỡ stack observability và port-forward cho Grafana, Jaeger, Prometheus | Lấy `ensurePortForward` của `main` cho edge; giữ phần observability của nhánh và cho ba cổng công cụ đi qua cùng cơ chế |
| `service/driver-service/test/integration/database.test.cjs` | Thêm 23 dòng kiểm tra | Thêm kiểm tra đọc theo lô | Giữ cả hai đoạn, chúng độc lập |

Sau khi merge nên chạy lại: test của Driver, `node --test deploy/stack.test.cjs`, `kube-up`, smoke.

## 8. Tự kiểm chứng

Cần Docker Desktop có Kubernetes, JDK 21 và Node. Từ thư mục gốc của repo, trên nhánh này:

```bash
node deploy/run.cjs build
```

```bash
node deploy/run.cjs kube-up
```

```bash
BACKEND_URL=http://127.0.0.1:18081 node deploy/smoke.cjs
```

```bash
node deploy/load/run.cjs --drivers 1000 --radius 6000 --rate 16 --duration 2m --warmup 30 --in-cluster 1 --events ws
```

Smoke chạy một chuyến hoàn thành và một chuyến huỷ qua Gateway thật. Lệnh cuối chạy 16 chuyến/giây trong 2 phút và ghi kết quả vào `deploy/.local/load/results/`. Muốn xem dashboard, thêm `OBSERVABILITY=on` trước lệnh `kube-up` rồi mở http://127.0.0.1:13000.

Kiểm tra tự động đã chạy trên nhánh: test đơn vị và typecheck của các service đã sửa, `node --test deploy/stack.test.cjs` (7 test), `node scripts/validate-docs.cjs`, smoke trên Kubernetes với observability bật và tắt.

## 9. Commit theo nhóm

| Nhóm | Commit |
| --- | --- |
| Bộ đo và báo cáo đầu | `bc1db9b`, `924c71c`, `a7c2056`, `01e786c`, `f42d95f` |
| Hàng đợi (ADR-0008) | `f8ecc7f`, `2dac6c0`, `a0fe3c3`, `3d1e440`, `91c8820` |
| A4, A6, A7, A8, A9 | `7a0eec9`, `bfac1f3`, `64ede3e`, `36b8643`, `3d034d4` |
| B7 | `d48fe7c`, `3cb0d8a` |
| ADR-0001 expand, migrate | `bcc8ecd`, `50f4f17`, `d6df2f9`, `80093e0` |
| ADR-0001 contract | `304cf6f`, `cceae34`, `a3cd200`, `fe97068`, `5c03191`, `5639a4b` |
| Deploy | `720fa49`, `9a6ee48` |
| Observability (ADR-0003) | `7ae5bd2`, `abea764`, `06bfc2b`, `e7a9aa2` |
| Bảo mật thư viện | `5c4f921` |
| Tài liệu | Các commit `docs:` còn lại, gồm `485dbce` (chấp nhận ADR-0001 và ADR-0008) |
