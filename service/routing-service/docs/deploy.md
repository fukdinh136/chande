# Deploy Routing Service

| Thuộc tính | Giá trị |
| --- | --- |
| Service | routing-service |
| Rà soát | 2026-10-06 |
| Quy ước | [Format và số liệu](../../../docs/quy-uoc-tai-lieu.md) |

OSRM tự host Hà Nội đã có cấu hình riêng: [runbook](osrm-ha-noi.md). Backend CAR, graph MLD và overlay Trip được chạy local; các phần hosting/HA, Realtime wire và profile xe máy trong kế hoạch production vẫn cần hoàn thiện.

Ngày cập nhật: 06/10/2026. App/lockfile/Dockerfile và Compose mock đã tạo; Docker smoke trên Linux đạt. HTTP Realtime adapter và OSRM ô tô Hà Nội đã chạy trong [stack Matching local](../../matching-service/docs/deploy.md). Dataset/profile ô tô được ghi ở [OSRM Hà Nội](osrm-ha-noi.md). Profile BIKE, production sizing và hosting chưa nghiệm thu.

## 1. Topology phase 1 đề xuất

| Thành phần | Cấu hình dự kiến | Dữ liệu / ranh giới |
| --- | --- | --- |
| Routing API | Node.js 24 + TypeScript 5.9 + NestJS 11/Express; port 3004; một process, một replica; 2 async workers | Queue/limiter trong RAM; không DB/outbox/broker |
| OSRM backend | Endpoint private do đội vận hành hoặc hosting cung cấp | Dataset đường; profile build; resource và giới hạn Table riêng |
| Realtime Service | Dependency ngoài Routing; ETA Matrix gọi qua Realtime Client với credential riêng | Vị trí trong 2000 m làm origins để Routing tính ETA trả Matching |
| Gateway / Trip / Matching | Gọi REST bằng token riêng | Không được truy cập key proxy/endpoint tùy ý |
| Secrets | Env local hoặc secret mount production | Không vào image/Git/log |

OSRM backend là process/container riêng; Routing gọi Route/Table bằng fetch với AbortController. Nhiều profile có thể cần endpoint/dataset riêng. Xem [cấu hình](cau-hinh.md). Không scale Routing replicas trước khi có quota coordination; mỗi process có limiter riêng.

Realtime Client có mock/real mode riêng; sau F11 cấu hình URL/credential theo wire contract Realtime. Không triển khai Realtime hoặc Matching trong Routing package. Smoke client bằng fake Realtime service: danh sách hợp lệ/rỗng, schema lỗi và timeout. Readiness/route estimate không gọi Realtime.

Sau F08, smoke R03 end-to-end bằng fake Realtime + OSRM: request pickup/profile → query radius 2000 → Table sources từ snapshot/destination=pickup → kết quả driverId/location/observedAt/ETA. Kiểm tra empty snapshot không gọi OSRM, lookup lỗi trả lỗi, snapshot quá cap không bị cắt và deadline chung 4 giây. Nghiệp vụ chọn/mời Matching để sau.

## 2. Chuẩn bị OSRM

Chọn hosting hoặc tự host, vùng dữ liệu phù hợp và profile đúng loại xe. Pin OSRM image/version và checksum dataset/profile cùng build manifest; kiểm tra disk/RAM trước khi preprocess, tránh tải dữ liệu toàn cầu mặc định. Tài liệu OSRM mô tả pipeline MLD: extract → partition → customize → routed; CH dùng contract. [OSRM quick start](https://github.com/Project-OSRM/osrm-backend#quick-start).

Chọn algorithm sau khi kiểm tra Table trả được cả duration và distance theo contract dự kiến. Nếu một cấu hình chỉ có duration thì không tự điền distance=0; chỉnh deployment hoặc review contract trước khi enable matrix. Ghi rõ dataset region/date, profile revision, algorithm, image digest, giới hạn tọa độ/URL và acceptance routes trong manifest ngoài secrets.

Public demo không phải endpoint production mặc định. Đọc [demo policy](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server) trước mọi thử nghiệm demo; các giới hạn ứng dụng trong `.env` không thay thế chính sách endpoint đó. OSRM tự host cần theo dõi chất lượng/cập nhật dữ liệu và tải tài nguyên, không giả định dịch vụ miễn vận hành.

Dataset lớn nằm trong volume/thư mục dữ liệu riêng, ngoài Git và build context của Routing. Triển khai/cập nhật dataset bằng pipeline riêng; không rebuild dữ liệu mỗi lần restart API. Chuẩn bị attribution OpenStreetMap ở app hiển thị bản đồ theo [OSM copyright](https://www.openstreetmap.org/copyright).

## 3. Local hiện tại

1. Cài Node.js 24 và npm; từ service root chạy `npm ci` với package-lock được tạo ở F00. Compiler dùng TypeScript 5.9, runtime NestJS 11/Express và Zod 4.
2. Sao chép example nếu chưa có file local; điền caller tokens. Chạy mock trước để kiểm tra API/queue mà không cần OSRM.
3. Khi OSRM đã sẵn sàng, điền base URL/allowlist và enabled vehicle mapping; chuyển real. Không bật MOCK_BIKE trong real.
4. App loader đọc `.env` từ service root theo F00 bằng dotenv; biến process env ghi đè dotenv; inline/file conflict được kiểm tra sau merge và settings validate bằng Zod. Secret mount là nguồn được chọn qua `_FILE`, không tự ghi đè inline.
5. Chạy một process bằng npm scripts dự kiến; development từ service root:

```powershell
npm.cmd ci
npm.cmd run start:dev
```

`start:dev` chạy `tsx watch src/main.ts`. Build và chạy production từ service root:

```powershell
npm.cmd run build
npm.cmd run start:prod
```

`build` chạy `tsc -p tsconfig.json`; `start:prod` chạy `node dist/main.js`. HOST/PORT lấy từ settings. Linux/container dùng npm. Probes `/health/live`, `/health/ready` không gọi provider; OpenAPI `/docs` và `/openapi.json` bật local. Body cap 64 KiB; token/scope khác nhau cho Trip/Matching/Gateway.

```powershell
docker build -t chande-routing:local .
npm.cmd run smoke:docker
docker compose -f compose.local.yml up -d --build
```

Compose dùng `.env` hiện có, yêu cầu ba caller token inline, không ghi đè file. Nó bật mock, dùng profile example trong image, bind host 127.0.0.1:3004; non-root, read-only filesystem, drop capabilities. Không dùng Compose local này cho production. Với token file mounts, tạo deployment riêng theo đường dẫn trong container; không truyền đường dẫn Windows vào container mà không mount.

Docker smoke tự sinh token test trong bộ nhớ và tạo container tạm: bốn API, 20 estimate đồng thời, restart, readiness và SIGTERM/exit. Container thử được xóa trong finally; không chạm container/volume Trip. Kết quả burst mock chỉ kiểm tra pipeline, không phải sizing OSRM. Lifecycle request đang chạy được test riêng bằng `app.close()`.

## 4. Tích hợp Trip sau kiểm thử

Giữ `POST /internal/routes/estimate`; chỉ trả hai số nguyên trong `data`. Đặt `ROUTING_BASE_URL` của Trip đến URL Routing theo topology; `ROUTING_TOKEN` Trip khớp `ROUTING_TRIP_TOKEN`. Deadline Routing đề xuất 4000 ms < timeout Trip hiện 5000 ms, có margin mạng. Mã xe enabled phải thống nhất; cần kế hoạch chuyển MOCK_BIKE sang mã real.

Không thay đổi env/source Trip trong task thiết kế. Khi tích hợp real, kiểm tra integration mode chung của Trip: bật real còn ảnh hưởng các dependency Pricing/Matching khác, nên không chỉ đổi một URL rồi coi toàn bộ hệ thống đã tích hợp. Matching/Gateway dùng token và scope riêng theo [routes](routes.md).

## 5. Docker / CI và điều kiện production

- Package-lock và Node 24.15.0 image/digest đã pin. [CI](../../../.github/workflows/routing-service.yml) chạy npm ci, lint/typecheck/test:all/build, test:trip và Trip contract, audit rồi build/smoke Docker. Workflow đã tạo; trạng thái GitHub run cần xem sau push. `.dockerignore` loại env/local profiles/secrets/test output/cache; runtime non-root, không bake secrets.
- Docker multi-stage: build stage cài đầy đủ dependency, compile TypeScript; runtime stage chỉ production dependencies và dist, chạy `node dist/main.js`. Env/secrets/profiles được inject hoặc mount; OSRM có image/dataset riêng.
- Chỉ mở Routing cho backend/probes; OSRM private. Public access đi Gateway với JWT, quyền và rate checks. HTTPS hoặc private HTTP được opt-in theo cấu hình, không truyền proxy key qua HTTP.
- Một replica, một Node process; queue/pool/limiter là singleton. WORKER_POOL_SIZE giới hạn map job async; mọi OSRM attempt đi qua worker/limiter. Realtime lookup dùng timeout/capacity riêng trước map queue. Set CPU/memory/response/queue caps và đo connection usage sau benchmark, không coi giá trị mẫu là production sizing.
- Deploy mock staging để smoke API, sau đó real với dataset kiểm chứng. Test route summary/full/matrix/recalculate, auth, queue overload và failure; không lấy public demo làm load test.
- Kiểm tra logs/metrics không lộ key/token/raw coordinates/URL query; docs/OpenAPI production mặc định tắt.

## 6. Lifecycle, quan sát và rollback

Startup validate config và tạo singleton runtime ở composition root; readiness chỉ true khi pool nhận job. Bật `app.enableShutdownHooks()`; `beforeApplicationShutdown` đóng admission, reject queued jobs ngay, drain active jobs trong grace, sau đó abort map/Realtime/HTTP requests còn lại trước khi đóng adapter. Mỗi Promise settle một lần và finally giải phóng slot. Process chết có thể mất job trong RAM; caller retry phép tính, không hứa durable delivery. [NestJS lifecycle](https://docs.nestjs.com/fundamentals/lifecycle-events).

Lifecycle tests gọi `app.close()` với job đang chạy; Linux smoke đã kiểm tra restart/SIGTERM với mock. Grace 5000 ms là mặc định; OSRM không bị dừng cùng Routing.

Theo dõi latency tổng và từng stage, queue depth/age/rejection, workers đang bận, outbound attempts/timeouts/errors, matrix elements, limiter waits, profile/dataset revision. Synthetic route kiểm tra đường đi riêng với tần suất được budget; không thực hiện trong mỗi readiness probe.

Rollback Routing bằng image/config revision trước; không có DB migration. Rollback OSRM bằng dataset/profile/image revision đã kiểm chứng riêng; giữ đủ dung lượng cho bản cũ trước rollout. Không xóa volume/dataset trong rollback tự động. Cập nhật bản đồ có thể đổi route/ETA, nhưng không đổi giá quote Trip đã chốt.
