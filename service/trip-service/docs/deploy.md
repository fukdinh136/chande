# Deploy và vận hành Trip Service

Ngày cập nhật: 05/10/2026. Trạng thái: runbook thiết kế đề xuất; chưa có backend, Dockerfile, Compose, npm script hoặc migration để thực thi các bước này.

Tài liệu liên quan: [Kiến trúc](kien-truc.md), [API](api.md), [Routes](routes.md), [Nghiệp vụ](nghiep-vu.md).

Chưa chọn nhà cung cấp hosting, domain, registry hay tài khoản deploy. Baseline đề xuất cho v1 là Docker Compose trên Linux cho staging/môi trường một host; production cần duyệt hosting, TLS, backup và vận hành trước khi dùng. Đợt tài liệu này không cài dependency, tạo hạ tầng hoặc thực hiện deployment.

## 1. Topology và giới hạn baseline

```mermaid
flowchart LR
    Client[Ứng dụng] -->|HTTPS| Gateway[Gateway / TLS ingress]
    Gateway -->|Backend network :3001| API[trip-api]
    API --> DB[(trip-db)]
    Worker[trip-worker] --> DB
    Worker --> External[Matching Gateway Notification]
    API --> Estimate[Routing Pricing / JWKS]
    Matching[Matching callback] -->|Private :3001| API
    Probes[Runtime monitoring] -->|Private :3001 / :3002| API
    Probes --> Worker
```

| Process/service | Port | Mạng và exposure | Dữ liệu lâu dài |
| --- | --- | --- | --- |
| `trip-api` | 3001 | Backend network cho Gateway/Matching; không publish internet | Không lưu state nghiệp vụ ở filesystem |
| `trip-worker` | 3002 cho probe | Backend network cho đích gửi; không API public | Outbox/inbox/receipt trong DB |
| `trip-db` | 5432 | Network riêng của Trip; không publish host production | Volume/DB managed có backup |
| `trip-migrate` | Không có port | Job một lần, chỉ truy cập DB Trip | Migration history |

API/worker dùng cùng image immutable, nhưng command và health probe khác nhau. `trip-api`/`trip-worker` nối backend network và network DB; DB chỉ nối network DB. Gateway và service ngoài không được quyền truy cập DB.

Compose một host không cung cấp HA; host hoặc DB ngừng sẽ gián đoạn. Không mô tả baseline này như zero-downtime hoặc hệ thống production đã có sẵn.

## 2. Runtime và artifact phải hoàn thành

- Đề xuất Node.js 24 LTS; kiểm tra version/patch tương thích khi triển khai C00 và pin image digest, không dùng `latest`. Node 24 thuộc nhánh LTS theo [Node.js releases](https://nodejs.org/en/about/previous-releases), đối chiếu ngày 05/10/2026.
- Đề xuất PostgreSQL 18; pin patch/digest và kiểm thử driver/TypeORM trước deploy. Không chốt version NestJS/TypeORM bằng tài liệu khi package chưa tồn tại: C00 phải khóa version tương thích trong lockfile.
- Build image theo [Docker multi-stage build](https://docs.docker.com/build/building/multi-stage/): stage build compile/test, runtime chỉ giữ output/dependency cần thiết và chạy bằng user không phải root.
- Runtime image có TypeORM CLI và migration đã compile để job migrate dùng cùng release. Không đưa source secret, `.env`, test database hoặc `node_modules` từ máy dev vào image.

| Artifact đề xuất | Yêu cầu trước khi runbook dùng được |
| --- | --- |
| `package.json`, `package-lock.json` | Npm scripts ở bảng dưới, runtime version và dependency được khóa |
| `Dockerfile`, `.dockerignore` | Image chứa `dist/main.js`, `dist/worker.js`, compiled DataSource/migrations và CLI |
| `.env.example`, `.gitignore` của service | Chỉ mẫu config; loại secret/runtime env khỏi Git |
| `compose.local.yml` | DB, mock services và port local; không dùng cho production |
| `compose.deploy.yml` | Đúng tên service/topology ở mục 1; health dependency, secrets, volume, image digest |
| DataSource/migrations | `synchronize=false`; schema phù hợp app, migration chỉ chạy bằng job |
| Health endpoints | Theo API/Routes, API và worker được kiểm tra độc lập |

Tất cả artifact trên **chưa tồn tại**. Tên và command là contract triển khai dự kiến, không phải hướng dẫn chạy ngay trong trạng thái repo hiện tại.

### Npm script contract dự kiến

| Script | Nhiệm vụ |
| --- | --- |
| `lint` / `typecheck` | Kiểm tra không sửa file; TypeScript noEmit |
| `test` / `test:integration` / `test:contract` / `test:e2e` | Unit / PostgreSQL thật / mock contract / toàn luồng |
| `build` | Compile giữ cấu trúc output đã mô tả trong Kiến trúc |
| `start:dev` / `worker:dev` | API/worker local với watch |
| `start:prod` / `worker:prod` | `node dist/main.js` / `node dist/worker.js` |
| `migration:show` / `migration:run` | CLI TypeORM dùng compiled DataSource, chạy sau build |

DataSource dự kiến tại `dist/infrastructure/persistence/data-source.js`; không tự chạy migration trong mỗi replica. Duyệt và xác minh cú pháp CLI theo version TypeORM thực tế lúc tạo package/migration.

## 3. Cấu hình môi trường đề xuất

| Biến | Local/test | Staging/production | Bên sử dụng |
| --- | --- | --- | --- |
| `NODE_ENV` | development/test | production | Cả hai |
| `INTEGRATION_MODE` | mock hoặc real | real, không cho mock | Cả hai |
| `PORT` | 3001 | 3001 private | API |
| `WORKER_HEALTH_PORT` | 3002 | 3002 private | Worker |
| `DATABASE_URL` hoặc `DATABASE_URL_FILE` | DB local/test riêng | Secret URL runtime role của DB Trip | Cả hai; migrate được cấp URL migration role riêng |
| `DB_POOL_SIZE` | 5 | 10 mỗi process, rà lại tổng pool khi scale | Cả hai |
| `AUTH_JWKS_URL` | JWKS của issuer thử | JWKS HTTPS đáng tin | API |
| `AUTH_JWT_ISSUER` | Issuer thử | Issuer của contract identity | API |
| `AUTH_JWT_AUDIENCE` | trip-service | trip-service, phải khớp issuer cấp token | API |
| `CURSOR_SIGNING_KEY_FILE` | Secret thử | Secret riêng ký cursor history | API |
| `SUPPORTED_VEHICLE_TYPES` | Các mã đã thống nhất với mock | Các mã contract service thật, không tự đặt mã mới | API/client |
| `ROUTING_BASE_URL` / `PRICING_BASE_URL` | Mock base URL | Private URL/HTTPS service thật | API |
| `MATCHING_BASE_URL` | Mock base URL | Matching service thật | Worker |
| `GATEWAY_EVENTS_BASE_URL` / `NOTIFICATION_BASE_URL` | Mock base URL | Private URL hai đích nhận event | Worker |
| `MATCHING_CALLBACK_TOKEN_FILE` | Credential Matching thử | Secret cho incoming assignment | API |
| `ROUTING_TOKEN_FILE` / `PRICING_TOKEN_FILE` | Credential thử | Outbound token riêng mỗi đích | API |
| `MATCHING_TOKEN_FILE` | Credential thử | Outbound token tới Matching, tách khỏi callback token | Worker |
| `GATEWAY_EVENTS_TOKEN_FILE` / `NOTIFICATION_TOKEN_FILE` | Credential thử | Token riêng mỗi đích | Worker |
| `HTTP_TIMEOUT_MS` | 5000 | 5000 đề xuất; kiểm thử contract trước đổi | API/worker |
| `OUTBOX_POLL_INTERVAL_MS` | 1000 | 1000 | Worker |
| `OUTBOX_BATCH_SIZE` / `OUTBOX_CONCURRENCY` | 20 / 5 | 20 / 5, tune theo DB/đích | Worker |
| `OUTBOX_LEASE_MS` | 30000 | 30000, lớn hơn timeout HTTP; renew lease khi cần | Worker |
| `OUTBOX_RETRY_BASE_MS` / `OUTBOX_RETRY_MAX_MS` | 1000 / 300000 | 1000 / 300000 + jitter | Worker |
| `WORKER_HEARTBEAT_MAX_AGE_MS` | 30000 | 30000; cập nhật khi poll và có tiến triển delivery | Worker probe |
| `SWAGGER_ENABLED` | true | false mặc định; staging chỉ private | API |
| `LOG_LEVEL` | debug/info | info, log đã loại secret | Cả hai |

Các số tuning là đề xuất, không phải SLA được xác nhận. Retry max là khoảng chờ tối đa **giữa hai lần gửi**, không phải thời hạn dừng tìm tài xế. Quote luôn theo quy tắc 5 phút, không đưa ra biến tuning để âm thầm thay chính sách giá.

`*_FILE` là chức năng cần triển khai trong config loader của Trip, không phải Nest tự hỗ trợ mọi biến này. Loader đọc file mounted secret; nếu hỗ trợ cả giá trị trực tiếp và `_FILE` cho cùng secret thì từ chối cấu hình đặt cả hai. Production thiếu config/secret cần thiết hoặc dùng mock phải startup fail.

Secrets đề xuất cấp qua secret manager hoặc [Docker Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/), mount trong `/run/secrets/` và chỉ cấp cho process cần dùng. Compose secrets là file mount, không tự cung cấp kho secret mã hóa; file nguồn cần được quản lý trên host. Không commit giá trị thật vào tài liệu, env example hoặc image.

## 4. Database và migration

- Database riêng `trip_db`; runtime role chỉ có quyền đọc/ghi dữ liệu cần thiết, migration role có quyền DDL riêng.
- Infra phải tạo database/roles và cấp secret trước job migrate. Không dùng tài khoản bootstrap PostgreSQL làm runtime user.
- Docker PostgreSQL 18 dùng volume đích `/var/lib/postgresql`, khác đường dẫn volume của các major cũ; theo [official PostgreSQL image](https://github.com/docker-library/docs/blob/master/postgres/README.md). Pin và kiểm tra đường dẫn theo image thực tế.
- DB health dùng `pg_isready`; `depends_on: condition: service_healthy` giúp Compose đợi DB sẵn sàng, theo [Docker startup order](https://docs.docker.com/compose/how-tos/startup-order/). Điều này không thay thế schema readiness hoặc retry kết nối trong app.
- Review SQL trên PostgreSQL thật, bao gồm unique active indexes, quote usage, history, receipt/inbox và outbox delivery.
- Chỉ một job migrate tại một thời điểm; dùng lock orchestration/database để hai đợt phát hành không cùng migrate.
- Dùng thay đổi schema có tính tương thích: thêm trước, chuyển app, bỏ cột/tên cũ ở release sau. Không dựa vào `synchronize` hoặc tự rebuild database.

## 5. Chạy local sau khi C00/C03 sẵn sàng

Điều kiện: package/scripts, `compose.local.yml`, config mock, migrations và health endpoints đã triển khai. Integration test dùng DB riêng, không dùng DB dev có dữ liệu người dùng.

Các lệnh dưới chạy từ `service/trip-service` trên PowerShell; chưa thực thi trong đợt viết tài liệu:

```powershell
npm.cmd ci
docker compose -f compose.local.yml up -d
npm.cmd run build
npm.cmd run migration:run
npm.cmd run start:dev
```

Mở terminal thứ hai, cùng thư mục/config:

```powershell
npm.cmd run worker:dev
```

Mock phải có Routing, Pricing, Matching, Gateway event receiver, Notification và issuer/JWKS thử. Matching mock phải giữ tìm xe không deadline, có tài xế chấp nhận, chống lặp và xử lý hủy trước search; không trả tài xế ngay để bỏ qua luồng async.

Chạy health API/worker, rồi estimate → create → callback nhận → cập nhật → hoàn thành. Test nhánh hủy dùng chuyến/quote mới. Không dùng cùng idempotency key cho các hành động khác nhau.

## 6. Build và phát hành

### CI cho release

1. Cài bằng lockfile; lint, typecheck, unit test.
2. Integration với PostgreSQL thật; contract với mock; e2e gồm API, worker và lỗi/race quan trọng.
3. Build image chứa app/migration; chạy image trong staging để kiểm tra entry point/probe/schema.
4. Tag theo commit SHA và lưu digest, migration list, config version, kết quả test.
5. Publish registry đã được chọn. Commit/push component theo quy trình người dùng duyệt; không coi push Git là đã deploy.

### Trình tự trên host Linux

Điều kiện: có `compose.deploy.yml` đã review, `deployment.env` không chứa secret thật, các mounted secret, backend network và backup/DB roles. `TRIP_IMAGE` trong deployment env trỏ digest phát hành; cả API/worker/migrate dùng cùng digest.

```bash
docker compose --env-file deployment.env -f compose.deploy.yml pull
docker compose --env-file deployment.env -f compose.deploy.yml up -d trip-db
docker compose --env-file deployment.env -f compose.deploy.yml run --rm --no-deps trip-migrate
docker compose --env-file deployment.env -f compose.deploy.yml up -d --no-deps trip-api trip-worker
docker compose --env-file deployment.env -f compose.deploy.yml ps
```

Đợi DB healthy và backup hoàn tất trước migrate. Dừng nếu một bước thất bại; không chạy tiếp API/worker khi migration lỗi. `trip-migrate` không có restart policy, runtime services có restart policy và shutdown grace đề xuất 30 giây.

Với release thay đổi lớn: ngừng nhận request mới/drain API và dừng claim delivery mới trước khi migrate theo maintenance window đã xác định. Graceful shutdown hoàn tất transaction đang xử lý, đóng DB pool; delivery chưa ghi ACK sẽ được reclaim bằng lease và chống lặp. Compose baseline không tự bảo đảm rolling deploy.

## 7. Smoke test và điều kiện nhận release

- API live/ready và worker live/ready đạt; schema đúng release. Probe readiness API không yêu cầu các đích outbox đang online.
- JWT đúng/sai và Matching credential đúng/sai cho kết quả đúng; `/internal/*`/probe/Swagger không public qua Gateway.
- Tạo quote rồi Trip SEARCHING; receipt/quote/history/outbox lưu nhất quán; worker gửi được command.
- Assignment chuyển ASSIGNED, sau đó đến/bắt đầu/hoàn thành đúng thứ tự, giá cuối đúng quote.
- Một chuyến khác thử hủy khi SEARCHING và khi DRIVER_ARRIVED; không phí, không tìm lại nếu tài xế hủy.
- Gửi lại create/callback không nhân đôi; callback mới sau hủy không gán lại.
- Ngắt mock đích event và restart worker: delivery pending còn, retry thành công sau khôi phục.
- Chuyến không có tài xế vẫn SEARCHING và khách hủy được. Không có job tự hủy do tuổi chuyến.

Dùng tài khoản/dữ liệu thử dành cho smoke test. Không dùng smoke test để thay đổi chuyến thật của người dùng.

## 8. Rollback và backup

### Rollback ứng dụng

1. Ghi nhận image/config đang chạy, lỗi và migration đã apply.
2. Xác nhận image trước tương thích schema hiện tại và payload outbox đang tồn đọng.
3. Đổi `TRIP_IMAGE` về digest đã xác nhận; redeploy **cả API và worker**, kiểm tra probes và smoke test.
4. Nếu schema không tương thích, giữ maintenance và dùng phương án khắc phục đã review; không tự drop bảng hoặc revert migration phá dữ liệu.

Không dùng xóa volume hoặc dựng DB trống như rollback. Worker cũ phải hiểu event pending, hoặc cần giữ worker tương thích tới khi giải quyết backlog.

### Backup/restore

- Đề xuất backup hàng ngày và trước migration; lưu ngoài host, mã hóa, kiểm tra restore vào DB riêng. Thời gian giữ/RPO/RTO cần chủ hệ thống duyệt, chưa có cam kết SLA.
- Backup gồm Trip, quotes, history, request receipts, inbox, outbox/deliveries và migration metadata cùng điểm nhất quán.
- Restore có thể làm lặp delivery hoặc khôi phục trạng thái cũ so với Matching/Gateway. Trước mở traffic phải đối soát assignment/cancellation và giữ chống lặp; không giả định chỉ restore DB là đồng bộ lại mọi service.
- Không tự cleanup receipt/inbox hoặc record outbox chưa giải quyết khi chưa có retention policy được duyệt.

## 9. Monitoring và xử lý sự cố

| Dấu hiệu | Kiểm tra/hành động | Không suy diễn |
| --- | --- | --- |
| API not ready | DB connection/role, migration/schema, config | Không coi DB unhealthy là lý do hủy chuyến |
| Worker not ready | DB/schema, heartbeat, dispatch loop, lease và process | Không dùng API health thay worker health |
| Delivery pending lâu | Worker, next retry, destination latency/network | Không kết luận Trip chưa tạo hoặc đã hủy |
| Delivery blocked | Response contract/credential/path; sửa và requeue có kiểm soát | Không mark delivered để bỏ lỗi |
| Matching đã ACK nhưng SEARCHING lâu | Đối soát search với Matching, ứng viên/lời mời và callback | Không tự hủy chuyến theo thời gian |
| Callback 409 | Active constraint, trạng thái/version và event ID | Không đổi event ID để ép gán |
| Nhiều version conflict | Client refresh/version, race và key reuse | Không bỏ kiểm tra version |

Log gồm request/trip/event/command ID và destination, không có JWT/service token/connection string hoặc snapshot hồ sơ đầy đủ. Alert tuổi outbox, worker heartbeat và SEARCHING lâu để điều tra, không gắn alert với chuyển trạng thái tự động.

## 10. Checklist trước triển khai thật

- [ ] Backend/artifact/script đã tồn tại và các lệnh trong runbook được kiểm chứng trên staging.
- [ ] Hosting, registry, TLS/ingress, networks và secret storage đã được chọn.
- [ ] API/worker/migrate dùng cùng digest và version schema phù hợp.
- [ ] Runtime role khác migration role; backup và restore drill đạt.
- [ ] Contract service ngoài, JWT issuer/audience, mã loại xe và credential đã thống nhất.
- [ ] Cấu hình mock bị chặn ở production; probe/Swagger/internal routes không public.
- [ ] Test concurrency/idempotency/outbox restart và các quy tắc nghiệp vụ đạt.
- [ ] Rollback tương thích schema/payload; có người phụ trách monitoring và xử lý blocked delivery.
- [ ] Đã cập nhật tài liệu nếu quá trình triển khai thay đổi contract/default đề xuất.
