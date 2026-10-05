# Deploy và vận hành Driver Service

Ngày 05/10/2026. Runbook thiết kế 0.1 draft, chưa có package/backend/Dockerfile/Compose/script để chạy. [Kiến trúc](kien-truc.md), [API](api.md), [Routes](routes.md), [Nghiệp vụ](nghiep-vu.md).

## 1. Topology đề xuất

| Thành phần | Port đề xuất | Vai trò và exposure |
| --- | --- | --- |
| driver-api | 3003 | REST private sau Gateway, health cùng process |
| driver-db | 5432 nội bộ | Database hiện có, runtime chỉ quyền cần thiết |
| Redis hiện có | 6379 nội bộ | State/GEO/lock theo ownership, không public |
| Trip API | 3001 theo draft nhóm | Chỉ HTTP; không cấp quyền trip_db cho Driver |
| Trip worker | 3002 probe theo draft nhóm | Không phải worker của Driver |

Chưa chọn hosting/registry/domain. Không triển khai hạ tầng trong đợt tài liệu. Driver v1 không có outbox worker, không cần tạo thêm bảng migration/worker ledger trong database chỉ để giống Trip. Runtime/compiler/library version sẽ pin khi D00 có package/lockfile; không gọi một command chưa tồn tại là đã kiểm thử.

## 2. Artifact cần có khi triển khai code

| Artifact tương lai | Điều kiện |
| --- | --- |
| package.json + lockfile | Scripts build/lint/typecheck/test/start rõ ràng |
| src/main.ts + composition root | Config validated, port 3003, guards/health |
| ORM entity/DataSource | Mapping schema hiện có, synchronize=false, không auto migration |
| Dockerfile/.dockerignore | Multi-stage, user runtime không root, không copy secret |
| .env.example | Chỉ placeholder, không token thật |
| compose.local.yml | DB/Redis test tách biệt, mock Trip/OTP |
| compose.deploy.yml | Private networks, secrets, image digest, backup |
| OpenAPI | Sinh/đối chiếu với API/Routes khi có controller |

Mục này là danh mục cần làm, không phải file đã tạo. Không cài lại Expo hoặc backend chỉ để chạy tài liệu Markdown.

## 3. Cấu hình đề xuất

| Biến | Giá trị/ý nghĩa | Kiểm tra |
| --- | --- | --- |
| NODE_ENV | development/test/production | Validate enum |
| PORT | 3003 | Không đụng Trip 3001/3002 trên local |
| DATABASE_URL_FILE | Secret kết nối driver_db | Không dùng quyền quản trị/Trip DB |
| REDIS_URL_FILE | Redis được phân quyền | Không log password |
| TRIP_BASE_URL | Private Trip base URL | Không có /api/v1 khi gọi trực tiếp |
| HTTP_TIMEOUT_MS | 5000 đề xuất | Không giữ DB transaction khi gọi HTTP |
| AUTH_JWT_ISSUER | Issuer đã chốt với Trip | Không tự đặt khác rồi coi liên thông |
| AUTH_JWT_AUDIENCES | driver-service,trip-service đề xuất | Verifier mỗi service kiểm tra audience của mình |
| AUTH_SIGNING_KEY_FILE | Private key khi Driver tự ký | Không gửi app/Trip private key |
| AUTH_KEY_ID | kid dùng rotation | JWKS có public keys tương ứng |
| ACCESS_TOKEN_TTL_SECONDS | 900 đề xuất | Cân đối logout không revoke access ngay |
| REFRESH_TOKEN_TTL_SECONDS | 2592000 đề xuất | Lưu expires_at thực tế |
| MATCHING_INBOUND_TOKEN_FILE | Credential riêng cho I01 | Không dùng token callback của Trip |
| OTP_MODE | mock/provider | Production cấm mock |
| OTP_PROVIDER_SECRET_FILE | Secret provider khi có | Validate theo adapter |
| OTP_TTL_SECONDS | 300 đề xuất | Dùng server time |
| OTP_RESEND_SECONDS | 60 đề xuất | Rate limit theo phone/IP |
| OTP_MAX_ATTEMPTS | 5 đề xuất | Challenge gắn SĐT/purpose |
| OTP_MOCK_CODE | Giá trị thử local | Không nằm trong tài liệu/API production |
| SUPPORTED_VEHICLE_TYPES | Danh mục nhóm chốt | Mỗi mã ≤20 và giống Trip/Matching |
| SWAGGER_ENABLED | true local, false production | Private exposure |
| LOG_LEVEL | info production | Redact token/SĐT/PII |

*_FILE là khả năng config loader phải triển khai, không mặc định Nest có sẵn. Thiếu secret/config bắt buộc thì startup fail. Nếu dùng issuer chung thì cấu hình ký/JWKS chuyển cho adapter issuer, không tạo hai nguồn khóa không đồng nhất. Chưa có provider được chọn, production gate chưa hoàn thành.

## 4. Giữ nguyên database

1. Có DDL/schema dump thật của driver_db; ảnh ERD không đủ để xác nhận nullable/default/check.
2. So cột/kiểu/unique/FK với bảng trong Kiến trúc. Kiểm tra phone/status đang tồn tại trước khi bật canonical/enum mới.
3. Mapping TypeORM rõ từng tên cột; synchronize=false và migrationsRun=false.
4. Không chạy migration tự thêm outbox, version, phone_verified_at hoặc updated_at cho vehicles.
5. Không DROP/reseed DB dùng chung. Test dùng bản sao/schema fixture riêng, không sao chép PII vào báo cáo.
6. Nếu cần DDL để dựng môi trường mới, dùng DDL nhóm đã xác nhận ở bước sau; không tự suy luận constraint thiếu từ ảnh.

Đợt hiện tại không tạo migration. Việc dùng thư viện tự tạo migration-history table cũng cần review vì yêu cầu không thêm bảng. Không gọi migration:run của Trip trên driver_db.

## 5. Baseline local và nhiều instance

Mock OTP in-memory chỉ hỗ trợ một Driver process; restart mất challenge, không bảo đảm rate limit chia sẻ. Dùng provider có verify/consume và rate limit phù hợp trước nhiều replica/production. Không khắc phục bằng cách âm thầm thêm key OTP ngoài contract Redis đã chốt.

Redis state/GEO có thể bị mất, không dùng làm bằng chứng trip đã kết thúc. Khi restart/reconnect, app đọc active Trip; Driver đọc lại desiredStatus và xác minh selection. Mất cache mà còn ONLINE không tự làm AVAILABLE.

JWT test phải thật sự được mock Trip verifier tin cậy; không tắt signature verification để làm demo pass. Mock Trip trả đúng data TripDTO/null và đúng tên trạng thái. Không sửa source Trip docs để hợp thức hóa mock khác contract.

## 6. Quy trình chạy sau khi code có đủ

Các script dưới là hợp đồng tương lai; chưa thực thi và hiện sẽ không chạy trong folder tài liệu:

```powershell
# Từ service/driver-service, CHỈ sau khi package và compose đã được triển khai
npm.cmd ci
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test
npm.cmd run test:integration
npm.cmd run test:contract
npm.cmd run build
npm.cmd run start:dev
```

Cần dựng DB/Redis test và Trip/OTP mock theo cấu hình trước integration. Không đưa lệnh migrate vào ví dụ vì baseline giữ schema. D09 sẽ kiểm tra OpenAPI; D10 chạy e2e token→profile→vehicle→selection→online→Matching→Trip→complete/cancel→offline.

## 7. Health và lỗi dependency

- /health/live: 200 {status:ok} khi process hoạt động.
- /health/ready: 200 {status:ready} nếu DB/schema/config cốt lõi phù hợp, ngược lại 503 {status:not_ready}. Không trả DSN/schema chi tiết.
- Redis/Trip/provider outage theo metric riêng; không làm mọi profile request mất readiness chỉ vì một dependency ngoài lỗi. Endpoint cần dependency trả 503 trước commit hoặc PENDING sau commit như API quy định.
- Nếu Redis không đọc được selection: không online. OFFLINE vẫn lưu được nếu DB hoạt động.
- Không trả 202 durable nhận event Driver vì không có inbox bền vững. Gateway event ACK theo Trip là trách nhiệm riêng cần kiểm chứng.

## 8. Kiểm thử và phát hành

Unit: rules/DTO/expiry; integration PostgreSQL thật cho unique và refresh rotation; Redis thật cho selection/loss/reconcile; contract mock Trip/JWT/Matching; e2e các DAC trong Nghiệp vụ. Không coi checklist là test đã chạy. Kiểm tra schema diff rỗng trước/sau.

Sau review kết quả: build image immutable; staging với DB/schema hiện có; verify health/auth/ownership/contracts; snapshot backup; triển khai theo quy trình nhóm. Chưa phát hành, commit hay push trong đợt này. Test deploy không dùng tài khoản hoặc OTP thật không được cấp phép.

## 9. Rollback

Rollback image/config tương thích schema; không rollback database bằng DROP vì không có schema change. Tránh rollback về code hiểu drivers.status khác nghĩa. Khóa JWT cũ giữ public key đủ lâu cho token chưa hết hạn trong kỳ rotation; không log private key. Refresh token đã revoke không phục hồi để thuận tiện rollback. Redis có thể rebuild, nhưng rebuild không tự giải phóng active Trip; đối soát trước công bố sẵn sàng.

## 10. Monitoring và checklist

Theo dõi OTP failures/rate limit, refresh conflicts, auth 401 giữa Driver–Trip, DB pool/errors, Redis pending sync, unknown state, Trip read timeouts, snapshot validation errors. Log requestId/driverId dạng phù hợp; không log OTP/JWT/refresh token/SĐT đầy đủ hoặc giấy phép.

- [ ] DDL đối chiếu, schema không đổi, runtime không có quyền DDL ngoài ý muốn.
- [ ] Prefix/ports không xung đột; internal/health/docs không public.
- [ ] JWT Driver được Trip/Gateway xác minh đúng chữ ký, issuer, audience.
- [ ] Mock/provider gate, concurrency refresh, loss response được kiểm thử.
- [ ] Có cơ chế đối soát DB/Redis và quyền sở hữu từng field/key đã chốt.
- [ ] Không có hứa hẹn durable outbox/receipt Driver hoặc thống kê tháng chưa triển khai.
- [ ] Chính sách race sửa xe/OFFLINE/accept được nhóm review trước nghiệm thu tích hợp.
- [ ] Các command/script tồn tại và được chạy thật trước gọi đây là runbook có thể thực thi.
