# ADR-0001: Matching sở hữu việc tìm ứng viên

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Matching, Realtime, Driver, Routing |
| Rà soát | 2026-11-05 |
| Quy ước | [Format và số liệu](../quy-uoc-tai-lieu.md) |

## Trạng thái

Đề xuất — phase 1, cải tiến P1.1 trong [Kiến trúc mục tiêu](../kien-truc-muc-tieu.md). Đã triển khai PR 1 (expand) và PR 2 (migrate) ngày 2026-11-05, xem [Triển khai](#triển-khai); PR 3 (contract) chờ kết quả đo Phase 1.

## Bối cảnh

Một job tìm xe hiện đi qua chuỗi gọi đồng bộ:

```text
Matching → Routing (ETA matrix)
             → Realtime (nearby-drivers)
                  → Driver (eligibility/batch)
                       → Trip (active-drivers/batch) + Matching (reservations/batch)
Matching → Driver (eligibility từng tài xế, N lần)
```

Vấn đề:

- **Vòng phụ thuộc:** Matching → … → Driver → Matching. Matching chậm thì chính job của Matching cũng chậm theo.
- **Sai trách nhiệm:** Routing (tính đường) quyết định ai là ứng viên; Realtime (vị trí) phải biết tài xế có eligible không.
- **Lỗi lan rộng:** một tài xế không xác định được availability làm Realtime trả `ELIGIBILITY_UNDETERMINED` cho cả request.
- **N+1:** Matching gọi eligibility lẻ cho từng ứng viên.
- Trong các hệ thống điều phối lớn, dispatch service tự truy vấn chỉ mục vị trí, tự lọc và xếp hạng; dịch vụ bản đồ chỉ tính ETA cho danh sách điểm được đưa vào.

Matching đã có thông tin "tài xế bận": reservation được giữ từ lúc gửi offer đến khi chuyến `COMPLETED` / `CANCELLED`. Unique constraint "một chuyến active trên một tài xế" ở Trip là chốt chặn cuối; assignment trả 409 thì Matching reject và tìm tiếp.

## Quyết định

Matching điều phối toàn bộ việc tìm ứng viên và gọi thẳng 3 service, mỗi service một lần:

| Bước | Service | API mới | Trả về |
| --- | --- | --- | --- |
| 1 | Realtime | `GET /internal/realtime/driver-locations?latitude&longitude&radiusMeters&limit` | Vị trí thô còn mới, không lọc nghiệp vụ; `limit` mặc định 50, tối đa 200 |
| 2 | Matching | — | Loại tài xế đã thử hoặc đang có reservation (một query DB) |
| 3 | Driver | `POST /internal/drivers/eligibility/candidates` `{driverIds ≤100, vehicleType}` | `eligible`, `reasons`, `vehicleId`, `vehicleType`, snapshot; **không** gọi occupancy; tài xế không xác định chỉ bị loại riêng |
| 4 | Matching | — | Top `MATRIX_CANDIDATES` (25) theo khoảng cách đường chim bay |
| 5 | Routing | `POST /internal/routes/eta-matrix` `{destination, vehicleType, origins[{id,lat,lng}] ≤50}` | `entries[{id,status,distanceMeters,durationSeconds}]` |
| 6 | Matching | — | `rank()` rồi tạo offer trong transaction, giữ lock và kiểm reservation |

`AssignDriver` vẫn kiểm lại eligibility đơn trước khi gọi Trip.

Triển khai theo **expand → migrate → contract**:

| PR | Nội dung |
| --- | --- |
| 1 — Expand | Thêm 3 API trên kèm test; guard Realtime tổng quát theo tên caller, credential mới `MATCHING_LOCATION_TOKEN`; Driver dùng `MATCHING_INBOUND_TOKEN` có sẵn. Endpoint cũ giữ nguyên |
| 2 — Migrate | Ports `LocationSource`, `DriverDirectory`, `EtaMatrix` trong Matching; viết lại `MatchDriver`; đưa số cứng vào config (`SEARCH_RADIUS_METERS`, `NEARBY_LIMIT`, `MATRIX_CANDIDATES`, `GPS_FRESHNESS_MS`, `GPS_FUTURE_MS`, `OFFER_TTL_MS`); chuyển SQL thô trong `match.ts` vào `Tx`; cờ `CANDIDATE_SOURCE=direct|routing` để rollback; cập nhật `deploy/stack.cjs` |
| 3 — Contract | Xoá `/routes/matrix`, `CalculateEtaMatrix`, client Realtime ở Routing; xoá `/nearby-drivers`, `FindNearby`, `DriverEligibilityClient` ở Realtime; xoá `/eligibility/batch`, `BatchEligibilityUseCase` ở Driver; dọn secret `routingRealtime`, `realtimeDriver`; cập nhật `hop-dong-lien-service.md`, `contract-baseline.json`, `smoke.cjs`, CI |

## Phương án đã cân nhắc

| Phương án | Lý do không chọn |
| --- | --- |
| Giữ Realtime → Driver, chỉ bỏ occupancy | Vẫn còn chuỗi 3 bước và Realtime vẫn biết luật nghiệp vụ |
| Realtime lưu sẵn loại xe + trạng thái trong Redis để lọc tại chỗ | Cần event từ Driver sang Realtime; đúng hướng nhưng nhiều việc hơn phase 1 cho phép. Ghi là hướng phát triển |
| Gộp Matching và Routing | Mất ranh giới rõ giữa "chọn ai" và "tính đường"; Routing còn phục vụ Trip và navigation |

## Hệ quả

- Tích cực: đồ thị gọi không còn vòng; mỗi job gọi Driver một lần thay vì N lần; lỗi một tài xế không làm hỏng cả lô; Routing và Realtime gọn lại.
- Tiêu cực: Matching phức tạp hơn; vị trí thô chưa lọc loại xe nên khu đông có thể bị một loại xe chiếm chỗ (giảm bằng `NEARBY_LIMIT=200`).
- Trạng thái `realtimeStatus` mà Driver chiếu vào Redis không còn được cập nhật mỗi lần có truy vấn nearby; cần kiểm app tài xế có dựa vào trường này không.
- Thứ tự deploy: các service của PR 1 → Matching → PR 3 chỉ sau khi smoke xanh.

## Tiêu chí hoàn thành

- Config: Routing không còn `REALTIME_*`; Realtime không còn `DRIVER_*`.
- Trace một job tìm xe: Matching gọi Realtime, Driver, Routing mỗi service đúng một lần; không request nào quay về Matching hoặc sang Trip.
- Test: tài xế đang có reservation không nhận offer thứ hai.
- Smoke CAR_4 / CAR_7 và `restart-check.cjs` xanh trên Docker và Kubernetes.

## Triển khai

Ngày 2026-11-05, nhánh `perf/adr-0008-trip-outbox`. Smoke CAR_4 / CAR_7 xanh trên Docker với cả `CANDIDATE_SOURCE=direct` và `routing`, và trên Kubernetes với `direct`; `restart-check.cjs` xanh trên Kubernetes, smoke chạy lại sau restart vẫn xanh. Đo tải cùng ngày ([báo cáo kiểm thử tải, mục 11](../bao-cao-kiem-thu-tai.md#11-đo-lại-sau-b7-và-adr-0001-2026-11-05)): mức đạt ngưỡng từ 6 lên 12 chuyến/giây, số câu SQL ở 4 chuyến/giây không còn tăng khi từ 2000 lên 5000 tài xế. Chưa trace số lời gọi mỗi lần tìm (tiêu chí thứ hai), việc này làm cùng B6.

| PR | Commit | Đã làm |
| --- | --- | --- |
| 1 — Expand | `bcc8ecd`, `50f4f17`, `d6df2f9` | Ba API ở bảng dưới, kèm test; endpoint cũ giữ nguyên |
| 2 — Migrate | `80093e0` | `DirectCandidates` và `RoutingCandidates` trong `application/candidates.ts`; cờ `CANDIDATE_SOURCE`; `deploy/stack.cjs` cấp credential mới |
| 3 — Contract | Chưa làm | Xoá đường cũ sau khi đo Phase 1 đạt |

API đã triển khai, khác bản thiết kế ở tên trường và credential:

| Service | API | Khác thiết kế |
| --- | --- | --- |
| Realtime | `GET /internal/realtime/driver-locations?latitude&longitude&radiusMeters&limit` | Trả `{radiusMeters, drivers[{driverId, latitude, longitude, distanceMeters, recordedAt}]}`. Redis dùng `GEOSEARCH ... COUNT limit` nên không có lỗi `SEARCH_CAPACITY_EXCEEDED` |
| Driver | `POST /internal/drivers/eligibility/candidates` `{driverIds ≤100, vehicleType}` | `vehicleType` bắt buộc. Trả `{items[{driverId, eligible, reasons, vehicleId, driverSnapshot, vehicleSnapshot}]}` cùng luật với `GET /:id/eligibility`; 2 câu SQL và 1 script Redis cho cả lô, không khoá, không ghi |
| Routing | `POST /internal/routes/eta-matrix` `{destination, vehicleType, origins[{id, lat, lng}] ≤50}` | Trả `{entries[{id, status, distanceMeters, durationSeconds}], calculatedAt}` |

Cấu hình Matching: `CANDIDATE_SOURCE` (`direct` mặc định, `routing` để lùi), `REALTIME_BASE_URL`, `REALTIME_MATCHING_TOKEN`, `NEARBY_LIMIT` (200), `MATRIX_CANDIDATES` (25). Realtime nhận `MATCHING_LOCATION_TOKEN`; thiếu biến này thì `/driver-locations` từ chối mọi caller. Hai biến dùng chung secret `matchingLocation`.

Hệ quả `realtimeStatus` đã kiểm: app tài xế đọc trường này qua `GET /drivers/me/availability`, và endpoint đó tự hỏi Trip và Matching rồi ghi lại trạng thái mỗi lần gọi, nên luồng mới không làm app hiển thị sai.
