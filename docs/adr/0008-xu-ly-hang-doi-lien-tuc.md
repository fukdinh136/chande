# ADR-0008: Xử lý hàng đợi liên tục cho outbox và worker

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Trip, Matching |
| Rà soát | 2026-10-30 |
| Quy ước | [Format và số liệu](../quy-uoc-tai-lieu.md) |

## Trạng thái

Đề xuất. Chưa có trong danh mục cải tiến của [kiến trúc mục tiêu](../kien-truc-muc-tieu.md); đề xuất làm trong Phase 1, cùng lúc với [ADR-0002](0002-truc-su-kien-rabbitmq.md) vì cả hai sửa worker outbox của Trip. Đây là mục A1, A2, A3, A5 trong [đề xuất cải tiến hiệu năng](../de-xuat-cai-tien-hieu-nang.md).

## Bối cảnh

[Kiểm thử tải](../bao-cao-kiem-thu-tai.md) cho thấy hệ thống chỉ gán được khoảng **2,5–3 chuyến/giây**, trong khi ở 3 chuyến/giây mọi pod vẫn dùng dưới 0,3 core. Kịch bản cao nhất còn đạt ngưỡng là khoảng 1000 tài xế với 2 chuyến/giây. Ở 4 chuyến/giây, đoạn `SEARCHING` → tạo offer tăng từ 1,2 lên 19,3 giây (p50), và đoạn offer → publish từ 1,0 lên 5,9 giây. Tăng `WORKER_CONCURRENCY` từ 8 lên 16 không cải thiện gì.

Nguyên nhân là ba vòng xử lý hàng đợi đều chạy theo nhịp cố định với lô giới hạn:

| Vòng | Hiện tại | Giới hạn |
| --- | --- | --- |
| Outbox Trip ([worker-runtime.ts](../../service/trip-service/src/bootstrap/worker-runtime.ts), [dispatcher.ts](../../service/trip-service/src/infrastructure/outbox/dispatcher.ts)) | Claim tối đa `OUTBOX_BATCH_SIZE=20` tin, gửi song song `OUTBOX_CONCURRENCY=5`, xong rồi **luôn** nghỉ `OUTBOX_POLL_INTERVAL_MS=1000`, kể cả khi lô đầy | khoảng 20 tin/giây; mỗi chuyến sinh khoảng 7,3 tin, nên trần khoảng 2,7 chuyến/giây |
| Publisher offer của Matching ([publisher.ts](../../service/matching-service/src/infrastructure/publisher.ts)) | Mỗi lượt gửi tối đa **10 tin**, số này viết cứng trong vòng lặp; chạy chung `tick` với worker ([worker.ts](../../service/matching-service/src/worker.ts)) qua `Promise.all`, và cả `tick` bị bỏ qua nếu lượt trước chưa xong | khoảng 10 tin/giây; mỗi chuyến khoảng 3,6 tin, nên trần khoảng 2,8 chuyến/giây |
| Worker Matching ([application/worker.ts](../../service/matching-service/src/application/worker.ts)) | Mỗi `WORKER_SCAN_MS=1000` claim tối đa `WORKER_CONCURRENCY` search, rồi chờ **cả lô** xong mới tới nhịp kế. Khi đã có offer chờ, search được đặt lại hạn sau 1 giây ([match.ts](../../service/matching-service/src/application/match.ts): `saveSearch(s, 1000)`), nên bị claim lại mỗi giây cho tới khi tài xế trả lời | Thông lượng bằng số job mỗi nhịp; mỗi chuyến cần 2–4 job (tìm, gán, các lần kiểm tra lại). Đây là trần kế tiếp sau khi gỡ hai vòng trên |

Khi hệ thống rảnh, mỗi chuyến còn chờ 3–4 nhịp 1 giây nối tiếp, nên tới `ASSIGNED` mất khoảng 3 giây dù mọi lời gọi HTTP nội bộ chỉ tốn 1–30 ms.

Một số cơ chế hiện có giúp thay đổi này an toàn:
- Claim ở cả hai service dùng `FOR UPDATE SKIP LOCKED` cùng partial index: `outbox_pending` ở Trip (claim đo được 0,03 ms) và `matching_due` ở Matching.
- Matching đã có `OfferExpiry` ([expiry.ts](../../service/matching-service/src/application/expiry.ts)), một vòng quét riêng làm hết hạn offer `PENDING` và đưa search về hàng chờ.
- Accept và decline ([decisions.ts](../../service/matching-service/src/application/decisions.ts)) tự đặt search về hạn ngay.

Vì vậy việc kiểm tra lại mỗi giây khi offer còn chờ là thừa.

## Quyết định

Ba vòng chuyển từ "mỗi nhịp một lô" sang **xử lý liên tục khi còn việc, chỉ nghỉ khi hàng đợi rỗng**. Không thêm hạ tầng mới.

**1. Outbox Trip**
- `dispatcher.tick()` trả về số tin đã claim. `worker-runtime.ts` lên lịch lượt kế **ngay** (`setImmediate`) nếu lượt vừa rồi claim đủ `OUTBOX_BATCH_SIZE`, ngược lại mới nghỉ `OUTBOX_POLL_INTERVAL_MS`.
- Mặc định mới: `OUTBOX_BATCH_SIZE=100`, `OUTBOX_POLL_INTERVAL_MS=250`. `OUTBOX_CONCURRENCY` giữ 5 và đặt được qua env.
- Khi ADR-0002 thay đích HTTP bằng đích `bus` (publisher confirm), cơ chế lặp này giữ nguyên.

**2. Publisher offer của Matching**
- Tách khỏi `tick` của worker: publisher có vòng riêng, nhận `PUBLISHER_BATCH_MAX` (mặc định 200) thay cho số 10 viết cứng.
- Mỗi lượt gửi lần lượt từng tin (giữ thứ tự `due_at` và publisher confirm như hiện tại), tới khi hết tin hoặc chạm `PUBLISHER_BATCH_MAX`. Chạm trần thì chạy lượt kế ngay; hết tin thì nghỉ `PUBLISHER_SCAN_MS` (mặc định 250).
- Trong cùng process, `MatchDriver` gọi `publisher.wake()` sau khi commit offer để gửi ngay, không chờ nhịp. Tin do matching-api ghi (accept, decline) vẫn được gửi theo nhịp `PUBLISHER_SCAN_MS`.
- Lỗi gửi giữ cơ chế backoff theo từng tin hiện có.

**3. Worker Matching**
- Thay `tick` theo lô bằng một pool giữ tối đa `WORKER_CONCURRENCY` job đang chạy. Còn chỗ trống thì claim ngay số job bằng số chỗ trống. Mỗi job xong là giải phóng chỗ và thử claim tiếp; không chờ job chậm nhất trong lô.
- Claim không ra job nào thì nghỉ `WORKER_SCAN_MS` (mặc định 250).
- Cơ chế gia hạn lease, `finishLease` và backoff khi lỗi giữ nguyên.
- Khi tạo offer, đặt hạn của search bằng `expires_at` của offer (hiện là 20 giây sau, cộng thêm vài trăm ms), thay cho 1 giây. Search được xử lý lại khi:
  - tài xế accept hoặc decline: `decisions.ts` đặt hạn ngay, như hiện tại;
  - `OfferExpiry` làm hết hạn offer, như hiện tại;
  - tới hạn: nhánh kiểm tra offer chờ trong `MatchDriver` vẫn được giữ làm lưới an toàn.
- `OfferExpiry` giữ vòng riêng, nhịp bằng `WORKER_SCAN_MS`.
- Mặc định `WORKER_CONCURRENCY` lên 16 (mức tối đa đang cho phép).

**4. Cấu hình**
- Mọi giá trị trên đọc từ env, có giới hạn trên như các biến hiện có.
- Cập nhật `deploy/stack.cjs` và tài liệu cấu hình của Trip và Matching.

## Phương án đã cân nhắc

| Phương án | Lý do không chọn |
| --- | --- |
| Chỉ đổi env: tăng `OUTBOX_BATCH_SIZE`, `WORKER_CONCURRENCY`, hạ nhịp | Không gỡ được số 10 viết cứng của publisher, cũng không gỡ được việc worker chờ cả lô; đo thực tế đặt `WORKER_CONCURRENCY=16` không cải thiện |
| Thêm replica worker (P2.5) mà giữ vòng theo nhịp | Mỗi replica vẫn có trần theo nhịp; tốn RAM để bù cho cách đọc hàng đợi. Vẫn làm ở P2.5, nhưng sau khi gỡ nhịp |
| PostgreSQL `LISTEN/NOTIFY` để đánh thức worker giữa các process | Phải giữ một kết nối riêng và xử lý mất kết nối. Với nhịp rảnh 250 ms và đánh thức trong cùng process, lợi ích còn lại nhỏ. Để làm sau nếu đo thấy cần |
| Publish offer thẳng lên RabbitMQ trong transaction tạo offer, bỏ outbox Matching | Mất tính nguyên tử giữa ghi offer và gửi event; outbox là lý do event không mất khi broker lỗi |
| Kafka hoặc hàng đợi job chuyên dụng (BullMQ) | Thêm hạ tầng; nghẽn nằm ở cách đọc hàng đợi, không phải ở loại hàng đợi. [Kiến trúc mục tiêu](../kien-truc-muc-tieu.md#9-những-gì-cố-ý-không-làm) đã loại Kafka |

## Hệ quả

**Tích cực**
- Thông lượng chỉ còn bị giới hạn bởi độ trễ thật của từng lời gọi và của PostgreSQL. Ước tính trần lên khoảng 6–10 chuyến/giây trên máy demo, cần đo lại.
- Khi rảnh, thời gian tới `ASSIGNED` từ khoảng 3 xuống khoảng 1 giây.
- Bỏ phần lớn job kiểm tra lại offer, nên worker không còn tốn chỗ cho việc thừa.
- Không thêm RAM hay thành phần mới. Công sức ước tính 3,5–4,5 ngày người, gồm test.

**Tiêu cực và rủi ro**
- Nhịp rảnh 250 ms tạo thêm khoảng 12 query/giây khi không có tải (ba vòng × 4 lần/giây). Mỗi query dùng partial index nên không đáng kể, nhưng cần đo bằng `pg_stat_statements`.
- Vòng lặp liên tục có thể chạy nóng nếu claim lỗi liên tục, nên phải nghỉ theo backoff khi lỗi, không lặp ngay.
- Worker không còn ranh giới lô, nên `lastProgress` (dùng cho readiness) phải cập nhật theo từng job xong, không theo nhịp.
- Search có offer chờ không còn được xem lại mỗi giây. Nếu `OfferExpiry` ngừng chạy thì offer quá hạn chỉ được xử lý khi tới hạn của search. Phải giữ nhánh an toàn trong `MatchDriver` và có test.
- Thông lượng cao hơn sẽ đẩy nghẽn sang chỗ khác: PostgreSQL (đã thấy 0,6–0,9 core ở 2000 tài xế), driver-api, các process Node một luồng. Đây là lý do cần [ADR-0003](0003-observability-opentelemetry.md) trước khi đo trần mới.

## Tiêu chí hoàn thành

**Test đơn vị và tích hợp**
- Outbox Trip: lượt claim đủ lô thì lượt kế chạy ngay; lượt không đủ lô thì nghỉ đúng `OUTBOX_POLL_INTERVAL_MS`.
- Publisher: 250 tin chờ được gửi hết trong một chuỗi lượt, không dừng ở 10; thứ tự gửi theo `due_at`; lỗi gửi một tin không chặn các tin khác quá backoff.
- Worker: một job chậm (giả lập Routing chậm 3 giây) không chặn các job khác bắt đầu; số job đang chạy không vượt `WORKER_CONCURRENCY`.
- Search có offer `PENDING` không bị claim lại trước khi tài xế trả lời hoặc offer hết hạn. Offer hết hạn vẫn được `OfferExpiry` xử lý và search được tìm tiếp.
- Smoke CAR_4 / CAR_7 và `restart-check.cjs` xanh trên Docker và Kubernetes.

**Đo lại** (theo [kế hoạch](../ke-hoach-kiem-thu-hieu-nang.md), cùng môi trường với lần đo trước)
- 1000 tài xế, 4 chuyến/giây, 2 phút: `SEARCHING` → `ASSIGNED` p95 ≤ 10 giây và không tăng dần theo thời gian; đoạn offer → publish p95 ≤ 200 ms.
- 1000 tài xế, 1 chuyến/giây: `SEARCHING` → `ASSIGNED` p95 ≤ 2 giây.
- Ghi kết quả trước/sau vào báo cáo kiểm thử tải.
