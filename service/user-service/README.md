# user-service v2

| Thuộc tính | Giá trị |
| --- | --- |
| Service | user-service |
| Rà soát | 2026-10-06 |
| Quy ước | [Format và số liệu](../../docs/quy-uoc-tai-lieu.md) |

Quản lý tài khoản khách đặt xe (RIDER): đăng ký/đăng nhập, phiên (refresh token xoay vòng), hồ sơ, địa chỉ đã lưu,
API nội bộ cho trip-service, JWKS. Đặc tả đầy đủ: [User Service v2](docs/user-service-v2.md).

Java 21 thuần: JDK `HttpServer` + virtual thread + JDBC. Không dùng web framework, không DI container.

## Cấu trúc

| Module | Nội dung | Phụ thuộc |
| --- | --- | --- |
| `user-core` | `domain` (quy tắc nghiệp vụ) + `application` (use case, port) | không có dependency ngoài |
| `user-adapters` | `http` (Router, xác thực, JSON), `persistence` (JDBC, Flyway), `security` (BCrypt, RS256, JWKS) | `user-core` + thư viện |
| `user-app` | `Main`, `AppConfig`; đóng gói fat jar | `user-adapters` |

Bảng route nằm ở `user-adapters/.../adapter/http/Routes.java`. Migration Flyway giữ nguyên của v1
(`user-adapters/src/main/resources/db/migration`) — **không sửa** nội dung hai file này.

## Build và test

```bash
./mvnw verify
```

Test lưu trữ (`JdbcPersistenceTest`) cần PostgreSQL thật: dùng Docker (Testcontainers) nếu có, hoặc trỏ tới một DB
có sẵn mà **tên chứa `test`** (các bảng trong DB này bị xoá và tạo lại). Không có cả hai thì các test này được bỏ qua.

```bash
TEST_DB_URL=jdbc:postgresql://localhost:5432/user_service_test TEST_DB_USERNAME=postgres TEST_DB_PASSWORD=123456 ./mvnw verify
```

## Chạy

Sinh khoá ký JWT (RSA ≥ 2048 bit, PKCS#8):

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out keys/user-2026-10.pem
```

```bash
DB_USERNAME=postgres DB_PASSWORD=123456 \
JWT_ISSUER=https://identity.example.invalid/rider \
JWT_PRIVATE_KEY_FILE=keys/user-2026-10.pem JWT_KEY_ID=user-2026-10 \
INTERNAL_API_KEY=change-me-at-least-16-chars \
java -jar user-app/target/user-service.jar
```

Biến môi trường (thiếu hoặc sai thì service dừng ngay và liệt kê mọi lỗi):

| Biến | Mặc định | Ghi chú |
| --- | --- | --- |
| `PORT` | `3011` | |
| `DB_URL` | `jdbc:postgresql://localhost:5432/user_service_db` | |
| `DB_USERNAME`, `DB_PASSWORD` | — | bắt buộc (`DB_PASSWORD` được để rỗng) |
| `DB_POOL_SIZE` | `10` | |
| `JWT_ISSUER` | — | bắt buộc, phải trùng `RIDER_JWT_ISSUER` của gateway |
| `JWT_PRIVATE_KEY_FILE` | — | RSA private key, PKCS#8 PEM |
| `JWT_KEY_ID` | — | `kid` của khoá hiện hành |
| `JWT_PREVIOUS_PUBLIC_KEYS_DIR` | trống | public key cũ còn trong thời gian chuyển tiếp, file `<kid>.pem` |
| `JWT_AUDIENCE` | trống | danh sách `aud`, phân tách bằng dấu phẩy; trống thì không ghi claim `aud` |
| `ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_TTL` | `15m` / `30d` | dạng `500ms`, `60s`, `15m`, `2h`, `30d` hoặc ISO-8601 |
| `JWT_CLOCK_SKEW` | `60s` | |
| `INTERNAL_API_KEY` | — | bắt buộc, ≥ 16 ký tự |
| `BCRYPT_COST` | `10` | |
| `MAX_BODY_BYTES` | `65536` | quá thì trả 413 `PAYLOAD_TOO_LARGE` |
| `SHUTDOWN_GRACE` | `20s` | |

Phía gateway: `USER_SERVICE_URLS=http://<user-service>:3011`, `RIDER_JWT_ISSUER` = `JWT_ISSUER`,
`RIDER_JWKS_URI=http://<user-service>:3011/.well-known/jwks.json`.

**Xoay khoá:** sinh khoá mới, đưa public key của khoá cũ vào `JWT_PREVIOUS_PUBLIC_KEYS_DIR` (tên file = kid cũ),
đổi `JWT_PRIVATE_KEY_FILE`/`JWT_KEY_ID` sang khoá mới. Giữ public key cũ ít nhất 15 phút + 60 giây + 5 phút sau lần ký
cuối bằng khoá đó (BR-33), rồi mới xoá.

## Các điểm mở (mục 14 của đặc tả) đã chọn khi code

| # | Chọn |
| --- | --- |
| 1. `aud` | Cấu hình qua `JWT_AUDIENCE`, mặc định không có |
| 4. Dọn refresh token | Mỗi giờ xoá token có `expires_at` cũ hơn 1 ngày |
| 5. Body quá lớn | 413 `PAYLOAD_TOO_LARGE` — "Dữ liệu gửi lên quá lớn" |
| 6. Giới hạn 72 byte của BCrypt | Mật khẩu mới (đăng ký, đổi mật khẩu) bị kiểm thêm ≤ 72 byte UTF-8 với message riêng; mật khẩu > 72 byte khi đăng nhập/đổi mật khẩu thì coi như sai mật khẩu |
| 7. `NOT_ACCEPTABLE` | Bỏ: luôn trả JSON |

Ngoài bảng lỗi DB ở mục 8, deadlock/serialization failure (`40P01`, `40001`) cũng trả 409 `DATA_CONFLICT`.
