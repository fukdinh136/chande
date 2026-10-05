# Kế hoạch phát triển Routing Service

Ngày lập: 06/10/2026. **Thiết kế để review; chưa triển khai runtime hoặc chạy các bộ kiểm thử dưới đây.** Mỗi feature hoàn thành phải có test tương ứng và commit nhỏ; báo cáo feature/commit/test/giới hạn sau triển khai.

## 1. Đã xác nhận và đề xuất cần validate

| Đầu mục | Trạng thái / cơ sở |
| --- | --- |
| Provider OSRM | Người dùng chọn trong phiên này |
| Ba use case và dispatcher → queue → pool → limiter → client | C3 người dùng cung cấp |
| ETA Matrix gọi Realtime Client trong Routing, lấy vị trí driver trong 2 km quanh pickup rồi tính ETA cho Matching | Người dùng xác nhận; Matching gửi pickup/profile, việc chọn/mời bên trong Matching để sau |
| Trip summary endpoint/envelope/strict hai số nguyên | [Trip client](../../trip-service/src/infrastructure/clients/routing.ts) và [test](../../trip-service/test/contract/routing.test.ts) đã có |
| Routing không đổi chuyến/giá/Matching decision | Ranh giới theo nghiệp vụ Trip và C3 |
| Node.js 24 + TypeScript 5.9 + NestJS 11 + Express; Zod 4 | Stack được chọn theo yêu cầu đổi kế hoạch sang TypeScript, đồng bộ Trip |
| Bounded queue trong RAM, một process/một replica, hai async workers, deadline 4 giây | Mặc định phase 1; capacity cần benchmark trước production |
| Full route, matrix, recalculate DTO/scope | Contract mới đề xuất trong [API](api.md), cần consumer validate |
| Hosting, endpoint, dataset vùng và profile xe máy | Chưa chốt; real BIKE chưa được bật |
| Giới hạn queue/rate/batch và cách làm tròn lên | Mặc định thiết kế, chưa có benchmark hoặc phê duyệt nghiệp vụ mới |

## 2. Thứ tự triển khai

Phase 1A: F00–F07 dựng pipeline và estimate/full route tương thích Trip. Phase 1B: F11 Realtime Client trước F08 ETA Matrix; F09 recalculate độc lập. Phase 1C: F10 deploy/benchmark. F11 chỉ cần F00/F01 nên có thể triển khai sớm. F08 nhận pickup/profile, lấy origins từ F11 và trả ETA cho Matching. Tích hợp OSRM/Realtime thật khi có endpoint/contract phù hợp; trước đó dùng fixture/mock. Nghiệp vụ lựa chọn/mời tài xế trong Matching để sau.

| Feature / commit đề xuất | Dependency | Kết quả review được | Kiểm thử và tiêu chí nghiệm thu |
| --- | --- | --- | --- |
| F00 `feat(routing): bootstrap config and secret loading` | Stack TypeScript đã chọn | Package npm/lockfile, strict tsconfig như Trip, ESLint/tsx/test scripts, Zod settings, dotenv/env/profile/secret loader | lint/typecheck/build; Mock/real; OSRM none không cần key; header thiếu key lỗi; env/file conflict; URL/allowlist/HTTP/profile validation; log không chứa secret |
| F01 `feat(routing): define route models and provider ports` | F00 | Domain/application TypeScript độc lập NestJS; Location/DriverLocation, Route/Matrix result, capability, Clock/dispatcher/provider/RealtimeLocation ports | Bounds/NaN/Infinity; lat/lng; làm tròn/INT32; unknown vehicle; driverId/location/observedAt DTO; validation trước mọi external call |
| F02 `feat(routing): add OSRM route and table adapters` | F01 | Mock deterministic và OSRM fetch adapter, AbortController/response cap, Zod schema/error mapping | Fake HTTP kiểm tra wire requests; summary/full/steps; Table N×1/null; HTTP200 nhưng code lỗi; response oversize/schema sai; no redirect; abort timeout/disconnect; không gọi public OSRM trong CI |
| F03 `feat(routing): bound outbound request and matrix rates` | F01 | Limiter request/burst + element budget, per-attempt permits | Fake monotonic clock; concurrent permits; retry vẫn trừ budget; batch vượt cap; timeout/cancel; không dùng sleep dài hoặc network làm test |
| F04 `feat(routing): dispatch jobs through bounded worker pool` | F02,F03 | Dispatcher Promise, bounded queue/async workers, shared deadline/signal, singleton runtime với NestJS lifecycle | Queue đầy/age hết hạn; pool concurrency cap; không lẫn result; worker sống sau job lỗi; finally giải phóng slot/timer/listener; canceled job không gửi; shutdown settle mọi Promise |
| F05 `feat(routing): implement calculate route views` | F04 | Use case summary/full, chọn profile/geometry | Đơn vị đúng; estimate chỉ hai fields; NO_ROUTE không fake success; profile không fallback; retry/backoff không vượt deadline |
| F06 `feat(routing): expose authenticated routing HTTP API` | F05 | NestJS + Express controllers/guards/filter, Zod DTO/envelope, correlation, probes, NestJS Swagger | Sai token/scope/body/header không gọi provider; exact 200 summary; lỗi sanitized; content-type/body cap; probes không external call |
| F07 `test(routing): verify Trip estimate compatibility` | F06 | Test cross-service chạy Routing mock qua HTTP thật; báo cáo tích hợp | Chạy [contract Trip hiện có](../../trip-service/test/contract/routing.test.ts) và adapter Trip thật trỏ Routing mock; lỗi/timeout không tạo quote; không thêm geometry vào summary; không đổi policy Trip |
| F11 `feat(routing): add realtime driver location client` | F00,F01 | RealtimeLocationPort, DTO, mock client và fetch real adapter sau khi xác nhận wire contract; settings riêng | Tâm/radius 2000 m; preserve ID/location/observedAt; empty khác lỗi; invalid/duplicate entries; auth/schema/oversize lỗi; timeout/cancel; redaction; không cần Matching hoặc OSRM để test client |
| F08 `feat(routing): calculate candidate ETA matrices` | F04,F06,F11 | R03 pickup/profile → Realtime snapshot trong 2 km → OSRM matrix → driver locations/observedAt/ETA trả Matching | Không nhận candidates; đúng tâm/radius; driver→pickup; map đúng ID/metadata qua batch; empty/error/cap overflow không gọi OSRM; partial/all NO_ROUTE; shared deadline lookup+matrix; cancel outstanding batches |
| F09 `feat(routing): recalculate from current location` | F05,F06 | Reroute dùng lại route logic; scope Gateway | currentLocation thực sự thành origin; destination giữ input; không gọi Trip DB/Pricing; geometry/steps/timeout như route |
| F10 `feat(routing): package and document deployment` | F07,F08,F09,F11 | Docker multi-stage build TypeScript/runtime Node 24, CI/Compose, npm scripts, báo cáo sizing | Smoke mock OSRM/Realtime; real OSRM riêng với dataset nhỏ đã chọn; probes, Linux signal shutdown, restart, overload/deadline, secrets mounts; giữ dữ liệu Trip khi rollback |

API R01–R04 là mã endpoint ở [routes](routes.md); F00–F11 là mã feature độc lập. F02 định nghĩa Table wire adapter; F11 cung cấp Realtime Client; F08 kết nối lookup → batching/application/HTTP matrix, cùng deadline. Giữ endpoint R03 nhưng sửa request/response thiết kế theo luồng mới, không thêm nearby endpoint. Không mở route chưa có use case/test hoàn chỉnh.

F00 đặt Node engines `>=24 <25`, TypeScript 5.9, NestJS 11 + Express, Zod 4, dotenv và NestJS Swagger. Toolchain npm/ESLint/tsx, compiler strict ES2023/Node16/decorator metadata tương tự Trip; dependency versions được lock khi tạo package. Cấu trúc `src/api`, `domain`, `application/use-cases`, `application/ports`, `infrastructure`, `bootstrap`, `test` theo [kiến trúc](kien-truc.md).

Các npm scripts dự kiến: `build` bằng tsc, `typecheck`, `lint`, `test:build`, `test`, `test:contract`, `test:integration`, `test:e2e`, `test:all`, `start:dev` bằng tsx và `start:prod` bằng node. Tổ chức test runner như Trip: compile TypeScript test trước, chạy `node:test` trên output `.test-dist`, tách suite unit/contract/integration/e2e. Package/scripts chưa được tạo ở task cập nhật tài liệu.

## 3. Acceptance theo nghiệp vụ

- Estimate: Trip nhận summary hợp lệ, tiếp tục Pricing/quote; Routing lỗi thì không có quote thành công. Quote TTL/giá/hủy/SEARCHING vẫn thuộc Trip.
- Route đầy đủ: geometry decode được, precision đúng, origin/destination đúng chiều, steps khi được yêu cầu có schema đủ. Không giả instruction tiếng Việt nếu chưa có formatter.
- Matrix: Matching gửi pickup/profile; Realtime snapshot cung cấp driverId/location/observedAt; Table lấy chiều driver→pickup. Empty snapshot trả entries rỗng, lỗi lookup trả lỗi trước map call; vượt cap không cắt danh sách. Khi mất một batch kỹ thuật, không trả danh sách thành công thiếu driver. Nghiệp vụ chọn/mời và eligibility trong Matching chốt sau.
- Realtime Client: thuộc Routing, chỉ lấy vị trí trong radius 2000 m; validate/giữ timestamp nguồn; empty list khác dependency lỗi; không tự tính ETA/mời/gán. Acceptance riêng theo [Realtime Client](realtime-client.md).
- Recalculate: trả tuyến từ vị trí mới; app/Gateway bỏ response cũ, kiểm soát tần suất. Không có mutation Trip hoặc recompute giá.
- Pipeline: caller có deadline hữu hạn; Promise settle một lần, signal truyền đến fetch và các bước chờ; không Promise treo/unhandled rejection; mọi nhánh giải phóng slot; request mới không bypass limiter, retry có permit riêng; queue không biến thành outbox/durable job.

## 4. Bộ kiểm thử dự kiến

| Lớp | Phạm vi |
| --- | --- |
| Unit | node:test + node:assert/strict; Zod/models/settings, rounding, profile/capability, result mapping, injected fake Clock/limiter |
| Adapter contract | Fake OSRM HTTP server: route/table/steps, số tọa độ/index/units, shape thiếu/null, code lỗi, redirect, malformed/oversize body, auth header và fetch abort |
| Realtime client contract | Fake Realtime server sau khi wire contract được chốt: center/radius 2000, driverId/location/observedAt mapping, empty/duplicate/schema errors, auth/timeout/cancel, response cap và redaction; không phụ thuộc Matching |
| ETA matrix orchestration | Fake Realtime + fake OSRM: R03 chỉ nhận pickup/profile, lookup đúng radius 2000, sources từ snapshot và destination=pickup, map ID/metadata/row qua batches; empty/error/cap overflow không có map request; latency lookup trừ khỏi deadline chung; chưa cần Matching implementation |
| Concurrency/lifecycle | Burst/queue-full, concurrency cap, deadline khi queue/rate/call/batch, disconnect, worker exception, drain/cancel; assert Promise settle một lần, không còn timer/listener/job, slot được giải phóng; lifecycle test dùng app.close(), signal shutdown kiểm tra trong Linux container |
| HTTP integration | Token scopes, correlation/envelopes, strict schemas và đủ endpoint; R03 từ chối candidates/radius override trong body; fake Realtime + OSRM cho matrix |
| Cross-service | Trip RoutingClient + Routing API thật chế độ mock, giữ contract hai số nguyên và xử lý dependency failure |
| Real smoke / benchmark | Server OSRM riêng, region/profile đã chọn; một tuyến và N×1 table ban đầu, sau đó tải có budget; ghi dataset/version/algorithm cùng kết quả |

Không thêm live provider/network test vào unit/CI mặc định. Test geometry bằng decode/endpoint hợp lệ; không so exact tuyến mãi mãi qua mọi dataset update. Dùng fixture versioned để phát hiện wire-contract regression; acceptance thực địa ghi riêng.

Kiểm tra tài liệu: liên kết/JSON/C3/stack nhất quán; R03 pickup/profile lấy origins qua Realtime, output theo driverId, F08 phụ thuộc F11 và có test orchestration; R01/R02/R04 và OSRM wire mapping giữ contract; env/profile local giữ nguyên. Chưa chạy runtime tests khi source/package chưa tồn tại.

## 5. Quy trình mỗi feature và phase sau

Trước code chốt đầu vào/đầu ra và criteria của feature; sau code chạy checks phù hợp, cập nhật docs/status và ghi báo cáo. Commit feature nhỏ chỉ gồm code/test/docs liên quan; kiểm tra không có `.env`, tokens, key hoặc dataset trong Git trước push. Không công bố runtime hoàn thành khi mới có tài liệu/config template.

Phase sau: thiết kế lựa chọn/mời tài xế, freshness/eligibility và reservation bên trong Matching dựa trên ETA/metadata mà Routing trả. Các mở rộng tùy nhu cầu đo được: global limiter khi scale, persistent cache sau review dữ liệu/attribution, breaker/tuning queue, traffic pipeline, gRPC, durable queue/job API với contract mới. Không mặc định thêm Redis/broker/outbox vào v1.
