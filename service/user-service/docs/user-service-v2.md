# User Service v2 — đặc tả và triển khai Java thuần

| Thuộc tính | Giá trị |
| --- | --- |
| Service | user-service |
| Rà soát | 2026-10-06 |
| Quy ước | [Format và số liệu](../../../docs/quy-uoc-tai-lieu.md) |

> Cập nhật 06/10/2026.
> Nguồn: code v1 trên nhánh `user-service` (commit `056bd00`) và api-gateway đang làm trên nhánh `api-gateway`.
> Runtime v2 đã triển khai bằng Java 21, không web framework; nghiệp vụ/core tách riêng. Mô tả v1 và các quyết định dưới đây giữ provenance; kết quả validation hiện tại ở tài liệu chung.

---

## 0. Các quyết định đã chốt

| # | Quyết định | Hệ quả |
| --- | --- | --- |
| Q1 | Giữ nghiệp vụ v1 | Đăng ký không OTP, không có quên mật khẩu, không Idempotency-Key, không outbox/sự kiện, hồ sơ không có `version` |
| Q2 | Giữ chức năng địa chỉ đã lưu | Contract 0.1 không có phần này, chỉ v1 có |
| Q3 | Chạy được sau api-gateway mới | Path tại service bỏ `/api/v1`; `/auth/logout` không cần JWT; access token ký **RS256**, công khai khoá qua **JWKS** |
| Q4 | Đổi mật khẩu thì thu hồi mọi phiên | Trả `{"passwordChanged": true}`, không cấp token mới (v1 có cấp) |
| Q5 | Giữ định dạng response và lỗi của v1 | Thành công trả body trần; lỗi trả `{code, message, fieldErrors}` |
| Q6 | Java 21 thuần | JDK `HttpServer` + virtual thread + JDBC. Được dùng thư viện nhỏ (JSON, BCrypt, connection pool, JWT, migration); không dùng Spring, Jakarta EE, Javalin, Micronaut… |

**Ngoài phạm vi v2:** OTP/SMS, quên/đặt lại mật khẩu, Idempotency-Key, outbox và sự kiện gửi Notification, envelope `{data, meta}`, API quản trị (khoá/mở tài khoản), rate limit (gateway đã làm).

---

## 1. Tổng quan

User Service quản lý tài khoản **khách đặt xe** (role `RIDER`). Tài xế do Driver Service quản lý riêng, dùng issuer JWT khác.

| Nhóm | Chức năng |
| --- | --- |
| Tài khoản và phiên | Đăng ký bằng SĐT + mật khẩu; đăng nhập; làm mới token (xoay vòng, phát hiện token bị dùng lại); đăng xuất một thiết bị; đăng xuất mọi thiết bị |
| Hồ sơ | Xem hồ sơ; sửa họ tên và ảnh đại diện; đổi mật khẩu |
| Địa chỉ đã lưu | Tối đa 10 địa chỉ; luôn có đúng 1 địa chỉ mặc định khi danh sách không rỗng; thêm, sửa, xoá, đặt mặc định |
| Nội bộ | Service khác (trip-service) tra thông tin cơ bản của một user bằng khoá nội bộ |
| Hạ tầng | Công khai khoá ký JWT (JWKS); health check |

```text
Mobile app ──HTTPS──> api-gateway :8080 ──(bỏ /api/v1)──> user-service :3011 ──JDBC──> PostgreSQL user_service_db
                        │ CORS, X-Request-Id, rate limit đăng ký/đăng nhập theo IP,
                        │ kiểm JWT (RS256 qua JWKS) và role RIDER cho /users/** và /auth/logout-all,
                        │ giới hạn body 256KB
                        └── GET http://user-service:3011/.well-known/jwks.json (gọi thẳng, cache 5 phút)

trip-service ──mạng nội bộ──> user-service :3011  GET /internal/users/{id}  (header X-Internal-Key)
```

**Gateway đã làm, service không cần làm:** CORS, sinh/chuyển tiếp `X-Request-Id`, rate limit, kiểm tra kích thước body ở biên.

**Service vẫn phải tự làm:**

- Kiểm JWT ở mọi endpoint RIDER. Không tin gateway, vì service có thể bị gọi thẳng trong mạng nội bộ.
- Kiểm khoá nội bộ cho `/internal/**`.
- Toàn bộ validation.

**Lưu ý:** gateway chuyển nguyên header `Authorization` xuống service. App thường gắn access token đã hết hạn khi gọi refresh/logout, nên endpoint **PUBLIC** phải **bỏ qua** header này, không được trả 401.

---

## 2. Quy ước HTTP chung

- Base URL local: `http://localhost:3011`. Path tại service **không có** `/api/v1`; path public ở gateway là `/api/v1` + path (ví dụ `/auth/login` ↔ `/api/v1/auth/login`).
- Request và response dùng JSON UTF-8. Response thành công trả **body trần**, không bọc envelope.
- **Trường JSON lạ bị bỏ qua**, giống v1. Ví dụ gửi kèm `phoneNumber` trong `PATCH /users/me` thì không có tác dụng gì.
- **Sai kiểu JSON bị từ chối**, ví dụ chuỗi ở chỗ cần số hoặc số ở chỗ cần chuỗi: trả 400 `VALIDATION_ERROR`, không kèm `fieldErrors`.
- Thời gian: chuỗi ISO 8601 UTC, độ chính xác micro giây như PostgreSQL, ví dụ `"2026-10-05T02:03:00.123456Z"`.
- UUID: chuỗi dạng chuẩn. Toạ độ: số JSON có 8 chữ số thập phân, ghi dạng thường (không dùng ký pháp khoa học như `0E-8`).
- Field có giá trị `null` trong response **vẫn được ghi ra** (ví dụ `"avatarUrl": null`), trừ `fieldErrors` trong body lỗi.
- Mức truy cập:
  - **PUBLIC**: không cần xác thực và bỏ qua mọi header xác thực.
  - **RIDER**: bắt buộc `Authorization: Bearer <access JWT>`, scheme `Bearer` không phân biệt hoa thường.
  - **INTERNAL**: bắt buộc `X-Internal-Key: <khoá>`.
- Header bảo mật trên mọi response nghiệp vụ. v1 có sẵn các header này nhờ mặc định của Spring Security, v2 phải tự đặt:
  `Cache-Control: no-cache, no-store, max-age=0, must-revalidate`, `Pragma: no-cache`, `Expires: 0`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`.
  JWKS là ngoại lệ (xem H1).
- Không đặt header CORS và `X-Request-Id` ở response; gateway xoá các header này rồi tự đặt lại. Nên **đọc** `X-Request-Id` của request để ghi vào log.
- Path khớp chính xác: `/users/me/` (thừa `/` cuối) trả 404.

### 2.1 Định dạng lỗi

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Dữ liệu không hợp lệ",
  "fieldErrors": { "password": "Mật khẩu phải có cả chữ và số" }
}
```

- `fieldErrors` chỉ có khi lỗi gắn được với từng trường. Khi không có thì **bỏ hẳn key**, không ghi `null`.
- Mỗi trường giữ **một** lỗi, là lỗi đầu tiên theo thứ tự kiểm: bắt buộc → độ dài → mẫu/khoảng giá trị. v1 không cố định thứ tự này; v2 chốt như trên.
- Body lỗi luôn có `Content-Type: application/json`, kể cả khi client gửi `Accept` khác.
- Lỗi 5xx không lộ stack trace, câu SQL hay secret. Stack trace chỉ ghi vào log.

### 2.2 Thứ tự xử lý một request

1. Khớp route: không có path thì trả 404 `ENDPOINT_NOT_FOUND`; có path nhưng sai method thì trả 405 `METHOD_NOT_ALLOWED`.
2. Xác thực theo mức truy cập: sai thì 401 `AUTHENTICATION_REQUIRED`; JWT hợp lệ nhưng `role` khác `RIDER` thì 403 `ACCESS_DENIED`.
3. Parse path param UUID: sai thì 400 `VALIDATION_ERROR` với `fieldErrors: {"<tên param>": "Giá trị không hợp lệ"}`.
4. Với endpoint có body: `Content-Type` phải là `application/json` (cho phép tham số như `; charset=utf-8`), sai thì 415 `UNSUPPORTED_MEDIA_TYPE`.
5. Đọc body (có giới hạn kích thước), parse JSON, kiểm kiểu. Body rỗng, JSON hỏng hoặc sai kiểu đều trả 400 `VALIDATION_ERROR`, không kèm `fieldErrors`.
6. Kiểm từng trường: 400 `VALIDATION_ERROR` có `fieldErrors`.
7. Chạy use case. Lỗi nghiệp vụ xem mục 6.

> **Khác v1:** v1 xác thực trước khi khớp route, nên gọi path lạ mà không có token sẽ nhận 401. v2 khớp route trước nên nhận 404. Đứng sau gateway thì không thấy khác biệt, vì gateway chỉ chuyển tiếp `/auth/**` và `/users/**`.

---

## 3. Danh mục API

| ID | Method | Path tại service | Truy cập | Thành công | Tương ứng v1 |
| --- | --- | --- | --- | --- | --- |
| A1 | POST | `/auth/register` | PUBLIC | 201 | `POST /api/v1/users/auth/register` |
| A2 | POST | `/auth/login` | PUBLIC | 200 | `POST /api/v1/users/auth/login` |
| A3 | POST | `/auth/refresh` | PUBLIC | 200 | `POST /api/v1/users/auth/refresh` |
| A4 | POST | `/auth/logout` | PUBLIC | 204 | `POST /api/v1/users/auth/logout` (v1 **cần JWT**) |
| A5 | POST | `/auth/logout-all` | RIDER | 204 | `POST /api/v1/users/auth/logout-all` |
| P1 | GET | `/users/me` | RIDER | 200 | `GET /api/v1/users/me` |
| P2 | PATCH | `/users/me` | RIDER | 200 | `PATCH /api/v1/users/me` |
| P3 | POST | `/users/me/password` | RIDER | 200 | `POST /api/v1/users/me/password` (v1 trả token mới) |
| D1 | GET | `/users/me/addresses` | RIDER | 200 | `GET /api/v1/users/me/addresses` |
| D2 | POST | `/users/me/addresses` | RIDER | 201 | `POST /api/v1/users/me/addresses` |
| D3 | PUT | `/users/me/addresses/{addressId}` | RIDER | 200 | như v1, thêm prefix |
| D4 | PUT | `/users/me/addresses/{addressId}/default` | RIDER | 200 | như v1, thêm prefix |
| D5 | DELETE | `/users/me/addresses/{addressId}` | RIDER | 204 | như v1, thêm prefix |
| I1 | GET | `/internal/users/{userId}` | INTERNAL | 200 | `GET /internal/users/{userId}` (không đổi) |
| H1 | GET | `/.well-known/jwks.json` | PUBLIC | 200 | **mới** |
| H2 | GET | `/health` | PUBLIC | 200 / 503 | `GET /actuator/health` |

- A1–A5, P\*, D\* đi qua gateway: path public là `/api/v1` + path ở cột 3.
- I1, H1, H2 chỉ gọi trong mạng nội bộ, gateway không định tuyến.
- Gateway (theo contract 0.1) còn khai báo `/auth/register/verify`, `/auth/otp/resend`, `/auth/password/forgot`, `/auth/password/reset` là public. v2 **không có** các route này nên service trả 404.

---

## 4. Chi tiết từng API

### 4.0 Các kiểu response dùng chung

```text
// TokenResponse — A2, A3
{ "accessToken": "<JWT>", "refreshToken": "<43 ký tự base64url>", "tokenType": "Bearer", "expiresIn": 900 }

// RegisterResponse — A1
{ "id": "<uuid>", "phoneNumber": "+84912345678", "fullName": "Nguyễn Văn A", "createdAt": "<thời gian>" }

// UserProfile — P1, P2
{ "id": "<uuid>", "phoneNumber": "+84912345678", "fullName": "Nguyễn Văn A", "avatarUrl": null, "createdAt": "<thời gian>" }

// Address — D1 (mảng), D2, D3, D4
{ "id": "<uuid>", "label": "Nhà", "addressText": "Keangnam Landmark 72, Phạm Hùng, Nam Từ Liêm, Hà Nội",
  "lat": 21.01700000, "lng": 105.78400000, "isDefault": true, "createdAt": "<thời gian>" }

// InternalUser — I1
{ "id": "<uuid>", "fullName": "Nguyễn Văn A", "phoneNumber": "+84912345678", "status": "ACTIVE" }
```

`expiresIn` là số giây sống của access token: 15 phút = 900.

**Quy ước validation dùng trong các bảng bên dưới:**

- "Bắt buộc" nghĩa là khác `null` **và** không rỗng sau `String.trim()`. `trim()` cắt các ký tự ≤ U+0020, giống `@NotBlank` của v1.
- Độ dài tính bằng `String.length()` trên giá trị **gốc**, chưa trim.
- Regex dùng `Pattern.matcher(s).matches()` (khớp toàn chuỗi). Trường `null` thì bỏ qua kiểm độ dài và regex.

---

### A1 — `POST /auth/register` (PUBLIC)

**Request**

```json
{ "phoneNumber": "091 234 5678", "password": "matkhau123", "fullName": "  Nguyễn Văn A  " }
```

| Trường | Quy tắc | Message khi vi phạm |
| --- | --- | --- |
| `phoneNumber` | bắt buộc | Số điện thoại không được để trống |
| | ≤ 20 ký tự | Số điện thoại quá dài |
| `password` | bắt buộc | Mật khẩu không được để trống |
| | 8–72 ký tự | Mật khẩu phải từ 8 đến 72 ký tự |
| | khớp `^(?=.*[A-Za-z])(?=.*\d).+$` | Mật khẩu phải có cả chữ và số |
| `fullName` | bắt buộc | Họ tên không được để trống |
| | ≤ 100 ký tự | Họ tên tối đa 100 ký tự |

**Luồng xử lý**

1. Validate các trường; sai thì 400 `VALIDATION_ERROR`.
2. Chuẩn hoá SĐT (quy tắc BR-01); sai thì 400 `INVALID_PHONE_NUMBER`, không chạm DB.
3. SĐT đã tồn tại thì 409 `PHONE_ALREADY_EXISTS`. Kiểm bước này **trước** khi băm, để không tốn thời gian BCrypt.
4. Băm mật khẩu bằng BCrypt.
5. Tạo user: `id` là UUID ngẫu nhiên, `status = ACTIVE`, `fullName` đã trim, `avatarUrl = null`, `createdAt = updatedAt = now`.
6. INSERT. Nếu vi phạm unique `uk_users_phone_number` (hai request cùng lúc) thì 409 `PHONE_ALREADY_EXISTS`.
7. Ghi log info `User registered: <id>`.

**Response 201** `RegisterResponse` với SĐT đã chuẩn hoá. **Không** tự đăng nhập, không trả token.

---

### A2 — `POST /auth/login` (PUBLIC)

**Request** `{ "phoneNumber": "0912345678", "password": "matkhau123" }`

| Trường | Quy tắc | Message |
| --- | --- | --- |
| `phoneNumber` | bắt buộc | Số điện thoại không được để trống |
| | ≤ 20 ký tự | Số điện thoại quá dài |
| `password` | bắt buộc | Mật khẩu không được để trống |
| | ≤ 72 ký tự (**không** có độ dài tối thiểu) | Mật khẩu quá dài |

**Luồng xử lý**

1. Validate; chuẩn hoá SĐT, sai thì 400 `INVALID_PHONE_NUMBER`.
2. Tìm user theo SĐT. **Không có** thì vẫn chạy BCrypt so với một *hash giả*, rồi trả 401 `INVALID_CREDENTIALS`. Hash giả được tạo một lần lúc khởi động, cùng cost với hash thật. Mục đích: thời gian phản hồi giống hệt trường hợp sai mật khẩu, nên kẻ dò không đo được SĐT nào đã đăng ký.
3. Sai mật khẩu thì 401 `INVALID_CREDENTIALS`.
4. Mật khẩu **đúng** nhưng `status = BLOCKED` thì 403 `USER_BLOCKED`. Tài khoản bị khoá mà gõ sai mật khẩu vẫn nhận 401.
5. Cấp cặp token (BR-10), trả **200** `TokenResponse`.

---

### A3 — `POST /auth/refresh` (PUBLIC)

**Request** `{ "refreshToken": "<raw>" }`

| Trường | Quy tắc | Message |
| --- | --- | --- |
| `refreshToken` | bắt buộc | Refresh token không được để trống |
| | ≤ 200 ký tự | Refresh token không hợp lệ |

**Luồng xử lý (một transaction)**

1. `hash = sha256Hex(raw)`, rồi `SELECT … FOR UPDATE` dòng token theo `token_hash`. Không có thì 401 `INVALID_REFRESH_TOKEN`.
   Khoá dòng để hai request refresh cùng một token chạy lần lượt: request sau thấy token đã xoay vòng và bị xử lý như dùng lại.
2. Token **đã xoay vòng** (`revoked_at` khác null) nghĩa là **có người dùng lại token**, nhiều khả năng token đã bị trộm. Xử lý: xoá **toàn bộ** refresh token của user, ghi log warn `Refresh token reuse detected for user <id>, deleted <n> tokens`, **COMMIT**, rồi trả 401 `INVALID_REFRESH_TOKEN`.
3. Token **hết hạn** (`expires_at < now`) thì 401 `INVALID_REFRESH_TOKEN`. Không xoá gì thêm.
4. User `BLOCKED` thì xoá toàn bộ token của user, ghi log info, **COMMIT**, rồi trả 403 `USER_BLOCKED`.
   Phải xoá thay vì chỉ đánh dấu, vì nếu không thì lần refresh sau bằng chính token này sẽ bị báo nhầm thành "dùng lại token".
5. Hợp lệ: đặt `revoked_at = now` cho token hiện tại, cấp cặp token mới (BR-10), COMMIT, trả **200** `TokenResponse`.

> ⚠️ Bước 2 và bước 4 **trả lỗi nhưng vẫn phải commit** thao tác xoá (v1 dùng `noRollbackFor`). Cách làm ở v2 xem mục 10.6.

Thứ tự kiểm là: tồn tại → đã xoay vòng → hết hạn → bị khoá. Một token vừa đã xoay vòng vừa hết hạn mà bị dùng lại vẫn kích hoạt xoá toàn bộ.

---

### A4 — `POST /auth/logout` (PUBLIC)

**Request** `{ "refreshToken": "<raw>" }`, validation giống A3.

**Luồng xử lý:** `DELETE FROM user_refresh_tokens WHERE token_hash = sha256Hex(raw)`, không quan tâm token còn hạn hay đã xoay vòng. Trả **204** trong mọi trường hợp, kể cả khi token không tồn tại, để không tiết lộ token có tồn tại hay không.

> **Khác v1:** v1 bắt buộc JWT và chỉ xoá khi token thuộc đúng user trong JWT. v2 không cần JWT, vì refresh token tự nó đã là credential: ai đang giữ token thì được thu hồi token đó.

---

### A5 — `POST /auth/logout-all` (RIDER)

Không cần body; nếu có body thì bỏ qua và không kiểm `Content-Type`.
Xoá toàn bộ refresh token của `sub`, ghi log info `User <id> logged out from all devices, deleted <n> tokens`, trả **204**. Không kiểm user có tồn tại hay không.

Access token đã cấp vẫn dùng được đến khi hết hạn (tối đa 15 phút), vì gateway và trip-service kiểm JWT offline.

---

### P1 — `GET /users/me` (RIDER)

Tìm user theo `sub`; không có thì 404 `USER_NOT_FOUND`. Trả **200** `UserProfile`.
v1 không kiểm `status` ở endpoint này: user bị khoá vẫn xem được hồ sơ cho đến khi access token hết hạn.

---

### P2 — `PATCH /users/me` (RIDER)

**Request**: cả hai trường đều tuỳ chọn. Bỏ trường hoặc gửi `null` nghĩa là **giữ nguyên**.

```json
{ "fullName": "  Nguyễn Văn B ", "avatarUrl": "https://cdn.example.com/a.png" }
```

| Trường | Quy tắc (khi khác null) | Message |
| --- | --- | --- |
| `fullName` | ≤ 100 ký tự | Họ tên tối đa 100 ký tự |
| | khớp `.*\S.*` | Họ tên không được để trống |
| `avatarUrl` | ≤ 500 ký tự | URL ảnh tối đa 500 ký tự |
| | khớp `^https?://\S+$` | URL ảnh phải bắt đầu bằng http:// hoặc https:// |

**Luồng xử lý:** tìm user, không có thì 404 `USER_NOT_FOUND`. Với mỗi trường khác null, gán giá trị đã `trim()`, rồi đặt `updatedAt = now`. Trả **200** `UserProfile`.

- Body `{}` hợp lệ: không đổi gì, vẫn trả 200. Không có body thì 400 `VALIDATION_ERROR`.
- Ghi đè kiểu last-write-wins, không có `version`.
- **Không xoá được avatar**: `null` nghĩa là giữ nguyên, còn `""` thì sai regex. Đây là giới hạn của v1 và v2 giữ nguyên.

---

### P3 — `POST /users/me/password` (RIDER)

**Request** `{ "oldPassword": "matkhau123", "newPassword": "matkhaumoi456" }`

| Trường | Quy tắc | Message |
| --- | --- | --- |
| `oldPassword` | bắt buộc | Vui lòng nhập mật khẩu hiện tại |
| | ≤ 72 ký tự | Mật khẩu tối đa 72 ký tự |
| `newPassword` | bắt buộc | Vui lòng nhập mật khẩu mới |
| | 8–72 ký tự | Mật khẩu mới phải từ 8 đến 72 ký tự |
| | khớp `^(?=.*[A-Za-z])(?=.*\d).+$` | Mật khẩu mới phải có cả chữ và số |

**Luồng xử lý**

1. Tìm user theo `sub`; không có thì 404 `USER_NOT_FOUND`.
2. `oldPassword` không khớp hash thì 400 `WRONG_OLD_PASSWORD`.
3. `newPassword.equals(oldPassword)` thì 400 `NEW_PASSWORD_SAME_AS_OLD`. Bước 2 kiểm trước bước 3.
4. Băm `newPassword`. Trong một transaction: cập nhật `password_hash`, `updated_at`, rồi **xoá toàn bộ refresh token** của user.
5. Ghi log info `User <id> changed password, deleted <n> refresh tokens`.

**Response 200** `{ "passwordChanged": true }`. App phải xoá token đang lưu và đăng nhập lại.

> **Khác v1:** v1 trả `TokenResponse` mới (200). Access token cũ vẫn sống tới hạn (≤ 15 phút) vì JWT là stateless.

---

### Địa chỉ đã lưu (D1–D5, đều RIDER)

**AddressRequest**, dùng cho D2 và D3:

```json
{ "label": "Nhà", "addressText": "Keangnam Landmark 72, Phạm Hùng, Nam Từ Liêm, Hà Nội",
  "lat": 21.017, "lng": 105.784, "makeDefault": true }
```

| Trường | Quy tắc | Message |
| --- | --- | --- |
| `label` | tuỳ chọn; ≤ 50 ký tự | Tên gợi nhớ tối đa 50 ký tự |
| `addressText` | bắt buộc | Địa chỉ không được để trống |
| | ≤ 500 ký tự | Địa chỉ tối đa 500 ký tự |
| `lat` | bắt buộc (số) | Thiếu vĩ độ |
| | −90 ≤ lat ≤ 90 | Vĩ độ phải từ -90 đến 90 |
| `lng` | bắt buộc (số) | Thiếu kinh độ |
| | −180 ≤ lng ≤ 180 | v1: "Vĩ kinh phải từ -180 đến 180" (viết nhầm). Đề xuất v2 sửa thành "Kinh độ phải từ -180 đến 180" |
| `makeDefault` | tuỳ chọn, boolean | — |

**Chuẩn hoá trước khi lưu (BR-21):**

- `label`: null hoặc rỗng sau trim thì lưu `null`; ngược lại lưu bản đã trim.
- `addressText`: lưu bản đã trim.
- `lat`, `lng`: `setScale(8, HALF_UP)`. Kiểm khoảng giá trị **trước** khi làm tròn.

`addressId` sai định dạng UUID thì 400 `VALIDATION_ERROR` với `fieldErrors: {"addressId": "Giá trị không hợp lệ"}`.
Địa chỉ của **user khác** được xử lý như không tồn tại: 404 `ADDRESS_NOT_FOUND`, không trả 403, để không lộ việc địa chỉ đó có tồn tại.

#### D1 — `GET /users/me/addresses`

Trả **200** mảng `Address`, sắp xếp `is_default DESC, created_at DESC` (mặc định lên đầu, sau đó mới nhất trước). Danh sách rỗng trả `[]`.

#### D2 — `POST /users/me/addresses`

1. `count` = số địa chỉ hiện có. `count ≥ 10` thì 400 `ADDRESS_LIMIT_REACHED`.
2. `makeDefault = (count == 0) || request.makeDefault == true`. Địa chỉ đầu tiên luôn là mặc định.
3. Nếu `makeDefault`: bỏ cờ mặc định của mọi địa chỉ khác **trước**, rồi mới INSERT. Thứ tự này cần thiết để không vi phạm unique index một-mặc-định.
4. INSERT, trả **201** `Address`. Không có header `Location`.

#### D3 — `PUT /users/me/addresses/{addressId}`

- Thay **toàn bộ** `label`, `addressText`, `lat`, `lng`. Bỏ `label` thì label bị xoá về `null`.
- `makeDefault == true`: bỏ mặc định các địa chỉ khác, đặt địa chỉ này làm mặc định.
- `makeDefault` là `false` hoặc `null`: **giữ nguyên** cờ mặc định hiện tại. Không bỏ được cờ mặc định qua API này.
- Không tìm thấy thì 404 `ADDRESS_NOT_FOUND`. Trả **200** `Address`.

#### D4 — `PUT /users/me/addresses/{addressId}/default`

Không có body. Bỏ mặc định các địa chỉ khác, đặt địa chỉ này làm mặc định. Không tìm thấy thì 404. Trả **200** `Address`.

#### D5 — `DELETE /users/me/addresses/{addressId}`

Không tìm thấy thì 404. Xoá địa chỉ. Nếu địa chỉ vừa xoá là mặc định thì địa chỉ **mới nhất** còn lại (theo `created_at DESC`) tự thành mặc định. Trả **204**.

---

### I1 — `GET /internal/users/{userId}` (INTERNAL)

- Header `X-Internal-Key` so **thời gian hằng** (`MessageDigest.isEqual` trên byte UTF-8) với khoá trong cấu hình.
- Thiếu hoặc sai khoá thì 401 `AUTHENTICATION_REQUIRED`. JWT người dùng **không** thay được khoá nội bộ. Ngược lại, khoá nội bộ cũng không mở được `/users/**`.
- `userId` sai định dạng thì 400 với `fieldErrors: {"userId": "Giá trị không hợp lệ"}`. Không tìm thấy user thì 404 `USER_NOT_FOUND`.
- Trả **200** `InternalUser`, gồm cả `phoneNumber` và `status`.

### H1 — `GET /.well-known/jwks.json` (PUBLIC, mới)

```json
{ "keys": [ { "kty": "RSA", "use": "sig", "alg": "RS256", "kid": "user-2026-10", "n": "<base64url>", "e": "AQAB" } ] }
```

- Chỉ chứa **public key**: khoá đang ký và các khoá cũ còn trong thời gian chuyển tiếp (BR-33).
- Header `Cache-Control: public, max-age=60`. Không có header no-store.

### H2 — `GET /health` (PUBLIC)

Trả 200 `{"status":"UP"}` khi `SELECT 1` tới DB thành công, ngược lại 503 `{"status":"DOWN"}`. Endpoint này thay cho `/actuator/health` của v1.

---

## 5. Quy tắc nghiệp vụ (bất biến)

Đánh số để test có thể tham chiếu.

**Tài khoản**

- **BR-01 Chuẩn hoá SĐT Việt Nam**
  1. Xoá các ký tự khoảng trắng ASCII, `.`, `-`, `(`, `)`.
  2. Đầu `0` thì thay bằng `+84`; đầu `84` thì thêm `+`; đầu `+84` thì giữ nguyên; còn lại là lỗi.
  3. Kết quả phải khớp `^\+84(3|5|7|8|9)\d{8}$`.

  Ví dụ hợp lệ: `0912345678`, `84912345678`, `+84912345678`, `091 234 5678`, `091.234.5678`, `0387654321`.
  Ví dụ không hợp lệ: `0123456789` (đầu số 01x đã bỏ), `091234567` (thiếu 1 số), `09123456789` (thừa 1 số).
- **BR-02** Mỗi SĐT (đã chuẩn hoá) chỉ thuộc một tài khoản; DB có unique constraint làm chốt chặn cuối.
- **BR-03** Chính sách mật khẩu mới (dùng cho đăng ký và đổi mật khẩu): 8–72 ký tự, có ít nhất một chữ cái Latin và một chữ số.
- **BR-04** Mật khẩu chỉ lưu dưới dạng hash BCrypt. v1 dùng `BCryptPasswordEncoder` mặc định: `$2a$`, cost 10. v2 **phải verify được hash `$2a$10$` cũ** trong DB.
- **BR-05** Trạng thái tài khoản chỉ gồm `ACTIVE` và `BLOCKED`. v1 có thêm `PENDING` trong enum, nhưng CHECK trong DB không cho phép giá trị này và không luồng nào dùng, nên v2 bỏ. Không có API khoá tài khoản; muốn khoá thì sửa trực tiếp trong DB.
- **BR-06** Tài khoản `BLOCKED`:
  - Đăng nhập đúng mật khẩu thì nhận 403.
  - Refresh thì nhận 403 và mất toàn bộ phiên.
  - Access token đã cấp vẫn dùng được tới khi hết hạn.
- **BR-07** API đăng nhập không được để lộ SĐT nào đã đăng ký: dùng chung lỗi 401 và chạy BCrypt với hash giả khi không tìm thấy user. Riêng API đăng ký **có** báo 409 khi SĐT đã tồn tại, đây là hành vi của v1.

**Phiên và token**

- **BR-10 Cấp cặp token**
  - Access JWT: RS256, sống 15 phút (mục 7).
  - Refresh token: 32 byte ngẫu nhiên từ `SecureRandom`, mã hoá base64url không padding (43 ký tự).
  - DB chỉ lưu `sha256Hex(raw)`: SHA-256 trên byte UTF-8 của **chuỗi** base64url, hex chữ thường, 64 ký tự. Lưu kèm `expires_at = now + 30 ngày` và `revoked_at = null`.
- **BR-11** Mỗi lần đăng nhập tạo một refresh token mới (một phiên/thiết bị). Không giới hạn số phiên.
- **BR-12** Refresh **xoay vòng**: token cũ được đánh dấu `revoked_at` và **giữ lại** trong DB làm bằng chứng phát hiện dùng lại; token mới có hạn mới tính từ lúc refresh (trượt 30 ngày).
- **BR-13** Dùng lại một token đã xoay vòng thì xoá **mọi** refresh token của user (đăng xuất mọi thiết bị).
- **BR-14** Đổi mật khẩu, logout-all, phát hiện dùng lại, hoặc user bị khoá mà refresh: đều xoá mọi refresh token của user.
- **BR-15** Hết hạn khi `expires_at < now` (so sánh chặt).

**Hồ sơ**

- **BR-20** Chỉ sửa được `fullName` và `avatarUrl`. Không sửa SĐT, trạng thái, `id`, `createdAt` qua API.

**Địa chỉ**

- **BR-21** Chuẩn hoá trường như mô tả ở mục 4 (D\*).
- **BR-22** Mỗi user có tối đa **10** địa chỉ.
- **BR-23** Mỗi user có **tối đa 1** địa chỉ mặc định (partial unique index trong DB). Khi danh sách không rỗng, các thao tác của API luôn giữ **đúng 1** mặc định:
  - địa chỉ đầu tiên tự thành mặc định;
  - xoá địa chỉ mặc định thì địa chỉ mới nhất còn lại lên thay.
- **BR-24** User chỉ thấy và thao tác được địa chỉ của chính mình. Địa chỉ của người khác được coi như không tồn tại.

**JWT và khoá**

- **BR-30** Access token chỉ được ký bằng khoá RSA hiện hành, `alg = RS256`, có `kid`.
- **BR-31** Khi verify phải từ chối: `alg` khác `RS256` (kể cả `none` và `HS256`), `kid` lạ, sai chữ ký, sai `iss`, thiếu hoặc quá hạn `exp` (cho lệch đồng hồ 60 giây như v1), `sub` không phải UUID, `role` khác `RIDER`.
- **BR-32** `iss` phải **trùng tuyệt đối** với `RIDER_JWT_ISSUER` cấu hình ở gateway.
- **BR-33** Xoay khoá: JWKS giữ public key cũ ít nhất `access TTL (15 phút) + skew + thời gian gateway cache JWKS (5 phút)` sau lần ký cuối cùng bằng khoá đó.

---

## 6. Mã lỗi

| Code | HTTP | Message | Phát sinh ở |
| --- | --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Dữ liệu không hợp lệ | Sai trường, JSON hỏng, thiếu body, path param sai |
| `INVALID_PHONE_NUMBER` | 400 | Số điện thoại không hợp lệ | A1, A2 |
| `ADDRESS_LIMIT_REACHED` | 400 | Bạn chỉ được lưu tối đa 10 địa chỉ | D2 |
| `WRONG_OLD_PASSWORD` | 400 | Mật khẩu cũ không đúng | P3 |
| `NEW_PASSWORD_SAME_AS_OLD` | 400 | Mật khẩu mới phải khác mật khẩu hiện tại | P3 |
| `INVALID_CREDENTIALS` | 401 | Số điện thoại hoặc mật khẩu không đúng | A2 |
| `INVALID_REFRESH_TOKEN` | 401 | Phiên đăng nhập không hợp lệ hoặc đã hết hạn | A3 |
| `AUTHENTICATION_REQUIRED` | 401 | Bạn cần đăng nhập hoặc token không hợp lệ | Endpoint RIDER/INTERNAL |
| `USER_BLOCKED` | 403 | Tài khoản đã bị khóa | A2, A3 |
| `ACCESS_DENIED` | 403 | Bạn không có quyền thực hiện thao tác này | JWT có role khác RIDER |
| `USER_NOT_FOUND` | 404 | Không tìm thấy người dùng | P1, P2, P3, I1 |
| `ADDRESS_NOT_FOUND` | 404 | Không tìm thấy địa chỉ | D3, D4, D5 |
| `ENDPOINT_NOT_FOUND` | 404 | Không tìm thấy API | Path không tồn tại |
| `METHOD_NOT_ALLOWED` | 405 | Phương thức HTTP không được hỗ trợ | Path đúng, method sai |
| `NOT_ACCEPTABLE` | 406 | API chỉ trả về dữ liệu dạng JSON | v1 có; v2 **tuỳ chọn** (có thể luôn trả JSON) |
| `PHONE_ALREADY_EXISTS` | 409 | Số điện thoại đã được đăng ký | A1 |
| `DATA_CONFLICT` | 409 | Dữ liệu vừa bị thay đổi bởi thao tác khác, vui lòng thử lại | Vi phạm ràng buộc DB không lường trước (ví dụ 2 request cùng đặt mặc định), đổi mật khẩu đồng thời |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Dữ liệu gửi lên phải ở dạng JSON | Body không phải `application/json` |
| `INTERNAL_ERROR` | 500 | Lỗi hệ thống, vui lòng thử lại sau | Mọi lỗi không lường trước |

Client nên dựa vào `code`, không nên dựa vào `message`.

---

## 7. Access token (JWT)

**Header**

```json
{ "alg": "RS256", "typ": "at+jwt", "kid": "user-2026-10" }
```

Gateway chấp nhận `typ` là `JWT` hoặc `at+jwt`.

**Payload**

```json
{
  "iss": "https://identity.example.invalid/rider",
  "sub": "30000000-0000-4000-8000-000000000001",
  "role": "RIDER",
  "iat": 1791165600,
  "exp": 1791166500,
  "jti": "50000000-0000-4000-8000-000000000001"
}
```

| Claim | Ý nghĩa |
| --- | --- |
| `iss` | Lấy từ cấu hình `JWT_ISSUER`; phải trùng `RIDER_JWT_ISSUER` của gateway |
| `sub` | `users.id` |
| `role` | Luôn là `RIDER` |
| `iat` / `exp` | `exp = iat + 900` |
| `jti` | UUID ngẫu nhiên. v1 không có; thêm vào để truy vết, không bắt buộc |
| `aud` | **Chưa chốt** (mục 14) |

**Ký:** `base64url(header) + "." + base64url(payload)`, ký `SHA256withRSA` bằng khoá RSA ≥ 2048 bit, nối thêm `"." + base64url(chữ ký)`.

**JWKS:** `n` và `e` là byte big-endian **không dấu** của modulus/exponent, mã hoá base64url không padding. Lưu ý: `BigInteger.toByteArray()` có thể thêm một byte `0x00` ở đầu, phải bỏ byte này đi.

**Chuyển từ v1:** refresh token giữ nguyên cách băm nên **vẫn dùng được** sau khi chuyển. Access token HS256 cũ sẽ bị từ chối; app nhận 401 thì gọi refresh và nhận token RS256 mới.

---

## 8. Dữ liệu

Giữ nguyên DB `user_service_db` và lịch sử Flyway của v1: `V1__init_schema.sql`, `V2__fix_user_addresses_columns.sql`. **Không sửa** nội dung hai file này, vì Flyway sẽ báo lệch checksum. Giữ cấu hình `baseline-on-migrate = true`, `baseline-version = 1` để DB cũ (bảng tạo bằng tay) vẫn chạy được.

Schema sau khi chạy V1 + V2:

```sql
users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number  varchar(15)  NOT NULL,             -- CONSTRAINT uk_users_phone_number UNIQUE
  password_hash varchar(255) NOT NULL,
  full_name     varchar(100) NOT NULL,
  avatar_url    text,
  status        varchar(20)  NOT NULL DEFAULT 'ACTIVE', -- ck_users_status: IN ('ACTIVE','BLOCKED')
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now()
)

user_refresh_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- ix_user_refresh_tokens_user_id
  token_hash varchar(64) NOT NULL,                                     -- uk_user_refresh_tokens_token_hash UNIQUE
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,                                              -- khác null = đã xoay vòng
  created_at timestamptz NOT NULL DEFAULT now()
)

user_addresses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- ix_user_addresses_user_id
  label        varchar(50),
  address_text varchar(500) NOT NULL,
  lat          numeric(10,8) NOT NULL,   -- ck_user_addresses_lat: -90..90
  lng          numeric(11,8) NOT NULL,   -- ck_user_addresses_lng: -180..180
  is_default   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
)
-- ux_user_addresses_one_default: UNIQUE (user_id) WHERE is_default
```

**Đổi lỗi DB thành mã lỗi API** (PostgreSQL SQLState và tên constraint):

| SQLState | Constraint | Mã lỗi API |
| --- | --- | --- |
| 23505 | `uk_users_phone_number` | `PHONE_ALREADY_EXISTS` |
| 23505 | `ux_user_addresses_one_default` | `DATA_CONFLICT` |
| 23503 (FK), 23505/23514 khác | — | `DATA_CONFLICT` |

**Lưu ý khi tự viết tầng lưu trữ:**

- v2 tự sinh `id` (UUID v4) và `created_at`/`updated_at` từ `Clock` rồi INSERT tường minh, không dựa vào DEFAULT. Thời gian cắt về **micro giây** (`truncatedTo(ChronoUnit.MICROS)`) để giá trị trả về khớp với giá trị lưu trong DB.
- `status` lưu dạng chuỗi tên enum.
- `lat`/`lng` đọc và ghi bằng `BigDecimal`.

---

## 9. Cấu hình (biến môi trường)

Service đọc toàn bộ cấu hình lúc khởi động. Thiếu hoặc sai giá trị thì **dừng ngay**, giống `@Validated` của v1.

| Biến | Mặc định | Ghi chú |
| --- | --- | --- |
| `PORT` | `3011` | Gateway mặc định gọi `http://localhost:3011`; v1 chạy 8081 |
| `DB_URL` | `jdbc:postgresql://localhost:5432/user_service_db` | |
| `DB_USERNAME`, `DB_PASSWORD` | — | v1 đang hard-code `postgres`/`123456` trong yaml; v2 chuyển sang biến môi trường |
| `DB_POOL_SIZE` | `10` | |
| `JWT_ISSUER` | — | Bắt buộc, phải trùng `RIDER_JWT_ISSUER` của gateway |
| `JWT_PRIVATE_KEY_FILE` | — | RSA private key, PKCS#8 PEM |
| `JWT_KEY_ID` | — | `kid` của khoá hiện hành |
| `JWT_PREVIOUS_PUBLIC_KEYS_DIR` | trống | Public key cũ (PEM, tên file = kid) còn trong thời gian chuyển tiếp |
| `ACCESS_TOKEN_TTL` | `15m` | |
| `REFRESH_TOKEN_TTL` | `30d` | |
| `JWT_CLOCK_SKEW` | `60s` | Bằng mặc định của Spring ở v1 |
| `INTERNAL_API_KEY` | — | Bắt buộc, ≥ 16 ký tự |
| `BCRYPT_COST` | `10` | |
| `MAX_BODY_BYTES` | `65536` | |
| `SHUTDOWN_GRACE` | `20s` | |

Phía gateway: đặt `USER_SERVICE_URLS`, `RIDER_JWT_ISSUER` (= `JWT_ISSUER`) và `RIDER_JWKS_URI=http://<user-service>:3011/.well-known/jwks.json`.

---

## 10. Khung code đề xuất (Java 21 thuần)

### 10.1 Nguyên tắc phụ thuộc

```text
bootstrap ──> adapter ──> application ──> domain
```

- **domain**: chỉ dùng `java.*`. Không import JDBC, JSON, HTTP hay thư viện nào khác.
- **application**: use case + port (interface), chỉ phụ thuộc domain. Đây là nơi chứa giao dịch nghiệp vụ, **không biết** HTTP hay SQL.
- **adapter**: cài đặt port (JDBC, BCrypt, RSA) và cửa vào HTTP. Chỉ adapter được dùng thư viện ngoài.
- **bootstrap**: `main()`, đọc cấu hình, tự tay nối các đối tượng (không DI container).

Để **trình biên dịch tự chặn** phụ thuộc sai chiều, nên tách Maven multi-module:

| Module | Gồm | Phụ thuộc |
| --- | --- | --- |
| `user-core` | domain + application | **không có** dependency ngoài (test: JUnit) |
| `user-adapters` | http, persistence, security | `user-core` + thư viện |
| `user-app` | bootstrap, tạo fat jar | `user-adapters` |

### 10.2 Cấu trúc package

```text
com.chande.userservice
├── domain
│   ├── common      ErrorCode, DomainException, ValidationException, FieldErrors
│   ├── user        User, UserStatus, PhoneNumber, PasswordPolicy
│   ├── session     RefreshToken
│   └── address     Address, AddressRules
├── application
│   ├── port        UserRepository, RefreshTokenRepository, AddressRepository,
│   │               PasswordHasher, AccessTokenIssuer, RefreshTokenFactory,
│   │               IdGenerator, TransactionRunner          (Clock dùng java.time.Clock)
│   ├── auth        AuthService, RegisterCommand, LoginCommand, RefreshCommand,
│   │               ChangePasswordCommand, TokenPair, RegisteredUser
│   ├── profile     ProfileService, UpdateProfileCommand, UserView, InternalUserView
│   └── address     AddressService, AddressCommand, AddressView
├── adapter
│   ├── http        UserHttpServer, Router, Route, PathTemplate, Access, Handler,
│   │               HttpRequest, HttpResult, ResponseWriter, Json, ErrorMapper, HttpError,
│   │               BearerAuthenticator, InternalKeyAuthenticator
│   │   ├── handler AuthHandlers, ProfileHandlers, AddressHandlers, InternalHandlers,
│   │   │           JwksHandler, HealthHandler
│   │   └── json    các record request/response đúng shape API (mục 4)
│   ├── persistence DataSourceFactory, Migrations, JdbcTransactionRunner,
│   │               JdbcUserRepository, JdbcRefreshTokenRepository, JdbcAddressRepository, SqlErrors
│   └── security    BCryptPasswordHasher, RsaKeys, Rs256AccessTokenIssuer, Rs256JwtVerifier,
│                   JwksDocument, SecureRefreshTokenFactory, UuidGenerator
└── bootstrap       Main, AppConfig
```

### 10.3 Domain

```java
// Mã lỗi nghiệp vụ: không biết HTTP status. Message tiếng Việt lấy từ v1.
public enum ErrorCode {
    VALIDATION_ERROR, INVALID_PHONE_NUMBER, PHONE_ALREADY_EXISTS, INVALID_CREDENTIALS, USER_BLOCKED,
    INVALID_REFRESH_TOKEN, WRONG_OLD_PASSWORD, NEW_PASSWORD_SAME_AS_OLD, USER_NOT_FOUND,
    ADDRESS_NOT_FOUND, ADDRESS_LIMIT_REACHED, DATA_CONFLICT;
    public String message() { ... }
}
public class DomainException extends RuntimeException { public ErrorCode code(); }
public final class ValidationException extends DomainException { public Map<String, String> fieldErrors(); }

// Gom lỗi theo trường, mỗi trường giữ lỗi đầu tiên (LinkedHashMap + putIfAbsent)
public final class FieldErrors {
    public FieldErrors required(String field, String value, String message);
    public FieldErrors required(String field, Object value, String message);   // cho BigDecimal
    public FieldErrors maxLength(String field, String value, int max, String message);
    public FieldErrors length(String field, String value, int min, int max, String message);
    public FieldErrors matches(String field, String value, Pattern pattern, String message);
    public FieldErrors between(String field, BigDecimal value, BigDecimal min, BigDecimal max, String message);
    public void throwIfAny();   // ném ValidationException nếu có lỗi
}

public record PhoneNumber(String value) {
    public static PhoneNumber parse(String raw);   // BR-01, ném DomainException(INVALID_PHONE_NUMBER)
}

public final class User {
    public static User register(UUID id, PhoneNumber phone, String passwordHash, String fullName, Instant now);
    public static User restore(...);                // adapter dùng khi đọc từ DB
    public boolean isBlocked();
    public void updateProfile(String fullName, String avatarUrl, Instant now);   // null = giữ nguyên, có trim
    public void changePasswordHash(String newHash, Instant now);
    // getters: id(), phone(), passwordHash(), fullName(), avatarUrl(), status(), createdAt(), updatedAt()
}

public final class RefreshToken {
    public static RefreshToken issue(UUID id, UUID userId, String tokenHash, Instant expiresAt, Instant now);
    public boolean isRevoked();
    public boolean isExpired(Instant now);   // expiresAt.isBefore(now)
    public void revoke(Instant now);         // chỉ đặt nếu đang null
}

public final class AddressRules {
    public static final int MAX_ADDRESSES = 10;
    public static void checkCanAdd(long currentCount);                         // ném ADDRESS_LIMIT_REACHED
    public static boolean becomesDefault(long currentCount, Boolean makeDefault);
}
```

### 10.4 Port (application/port)

```java
public interface UserRepository {
    boolean existsByPhone(PhoneNumber phone);
    Optional<User> findByPhone(PhoneNumber phone);
    Optional<User> findById(UUID id);
    void insert(User user);                                      // trùng SĐT -> DomainException(PHONE_ALREADY_EXISTS)
    void updateProfile(User user);
    boolean updatePasswordHash(UUID id, String expectedOldHash, String newHash, Instant now); // false = có người đổi trước
    void lockForUpdate(UUID id);                                 // SELECT ... FOR UPDATE, dùng cho địa chỉ
}

public interface RefreshTokenRepository {
    void insert(RefreshToken token);
    Optional<RefreshToken> findByHashForUpdate(String tokenHash);
    void markRevoked(UUID id, Instant revokedAt);
    void deleteByHash(String tokenHash);
    int deleteAllByUserId(UUID userId);
}

public interface AddressRepository {
    List<Address> listByUser(UUID userId);                       // is_default DESC, created_at DESC
    Optional<Address> findOwned(UUID userId, UUID addressId);
    long countByUser(UUID userId);
    Optional<Address> findNewest(UUID userId);
    int clearDefault(UUID userId);
    void insert(Address address);
    void update(Address address);                                // label, address_text, lat, lng, is_default
    void delete(UUID addressId);
}

public interface PasswordHasher {
    String hash(String raw);
    boolean matches(String raw, String hash);
}

public interface AccessTokenIssuer {
    record AccessToken(String value, long expiresInSeconds) {}
    AccessToken issue(UUID userId, Instant now);
}

public interface RefreshTokenFactory {
    record NewRefreshToken(String raw, String hash) {}
    NewRefreshToken generate();          // 32 byte SecureRandom -> base64url -> sha256Hex
    String hash(String raw);             // sha256Hex
}

public interface IdGenerator { UUID newId(); }

/** Commit khi work trả về bình thường; rollback khi work ném bất kỳ exception nào. Gọi lồng nhau thì dùng chung transaction ngoài. */
public interface TransactionRunner {
    <T> T inTransaction(Supplier<T> work);
    <T> T readOnly(Supplier<T> work);
}
```

### 10.5 Use case (application)

**Command** tự validate trong compact constructor, nên một command đã tạo được thì luôn hợp lệ, và message lỗi theo trường nằm ở tầng nghiệp vụ, test được mà không cần HTTP:

```java
public record RegisterCommand(String phoneNumber, String password, String fullName) {
    private static final Pattern LETTER_AND_DIGIT = Pattern.compile("^(?=.*[A-Za-z])(?=.*\\d).+$");
    public RegisterCommand {
        new FieldErrors()
            .required("phoneNumber", phoneNumber, "Số điện thoại không được để trống")
            .maxLength("phoneNumber", phoneNumber, 20, "Số điện thoại quá dài")
            .required("password", password, "Mật khẩu không được để trống")
            .length("password", password, 8, 72, "Mật khẩu phải từ 8 đến 72 ký tự")
            .matches("password", password, LETTER_AND_DIGIT, "Mật khẩu phải có cả chữ và số")
            .required("fullName", fullName, "Họ tên không được để trống")
            .maxLength("fullName", fullName, 100, "Họ tên tối đa 100 ký tự")
            .throwIfAny();
    }
}
```

**Service** (mỗi nhóm một class; HTTP adapter gọi trực tiếp):

```java
public final class AuthService {
    public RegisteredUser register(RegisterCommand cmd);
    public TokenPair login(LoginCommand cmd);
    public TokenPair refresh(RefreshCommand cmd);
    public void logout(RefreshCommand cmd);
    public void logoutAll(UUID userId);
    public void changePassword(UUID userId, ChangePasswordCommand cmd);
}
public final class ProfileService {
    public UserView getProfile(UUID userId);
    public UserView updateProfile(UUID userId, UpdateProfileCommand cmd);
    public InternalUserView getInternalUser(UUID userId);
}
public final class AddressService {
    public List<AddressView> list(UUID userId);
    public AddressView create(UUID userId, AddressCommand cmd);
    public AddressView update(UUID userId, UUID addressId, AddressCommand cmd);
    public AddressView setDefault(UUID userId, UUID addressId);
    public void delete(UUID userId, UUID addressId);
}

public record TokenPair(String accessToken, String refreshToken, long expiresInSeconds) {}
```

Use case trả `record` view (`UserView`, `AddressView`…) thay vì entity, để adapter không gọi nhầm được hàm thay đổi trạng thái.

**Phạm vi transaction và khoá:**

| Use case | Transaction | Khoá / chống tranh chấp | Khác v1 |
| --- | --- | --- | --- |
| register | Kiểm tồn tại và BCrypt **ngoài** tx; tx chỉ có INSERT | unique `uk_users_phone_number` | v1 giữ connection trong lúc BCrypt |
| login | Đọc user và BCrypt ngoài tx; tx INSERT refresh token | — | như trên |
| refresh | 1 tx, **commit cả khi trả lỗi** reuse/blocked (10.6) | `FOR UPDATE` dòng token | — |
| logout / logoutAll | 1 câu DELETE | — | — |
| changePassword | BCrypt ngoài tx; tx: UPDATE có điều kiện `password_hash = <hash vừa đọc>`, rồi DELETE token | So-sánh-rồi-ghi trên hash; 0 dòng cập nhật thì `DATA_CONFLICT` | v1 không xử lý đổi mật khẩu đồng thời |
| updateProfile | tx: SELECT + UPDATE | — (last-write-wins) | — |
| address create/update/setDefault/delete | 1 tx | `users.lockForUpdate(userId)` để tuần tự hoá thao tác địa chỉ của cùng user | v1 đếm không khoá: 2 request đồng thời có thể vượt 10 |

Luôn gọi `clearDefault` **trước** khi đặt địa chỉ mới làm mặc định.

### 10.6 Transaction với JDBC và "trả lỗi nhưng vẫn commit"

`JdbcTransactionRunner` giữ `Connection` hiện tại trong `ThreadLocal`; mỗi request chạy trên một virtual thread riêng nên cách này an toàn. Repository lấy connection qua `ConnectionProvider` do chính runner cài đặt:

- Đang trong tx thì dùng connection của tx.
- Ngoài tx thì mượn một connection auto-commit rồi trả lại ngay.

Mức isolation để mặc định `READ COMMITTED` như v1.

Refresh không ném lỗi bên trong tx. Use case trả về một kết quả, rồi mới ném lỗi sau khi tx đã commit:

```java
sealed interface RefreshOutcome {
    record Issued(TokenPair pair) implements RefreshOutcome {}
    record Rejected(ErrorCode code) implements RefreshOutcome {}
}

public TokenPair refresh(RefreshCommand cmd) {
    String hash = refreshTokenFactory.hash(cmd.refreshToken());
    RefreshOutcome outcome = tx.inTransaction(() -> {
        RefreshToken current = refreshTokens.findByHashForUpdate(hash).orElse(null);
        if (current == null) return new Rejected(INVALID_REFRESH_TOKEN);
        Instant now = clock.instant();
        if (current.isRevoked()) {                                  // BR-13
            int n = refreshTokens.deleteAllByUserId(current.userId());
            log.warn("Refresh token reuse detected for user {}, deleted {} tokens", current.userId(), n);
            return new Rejected(INVALID_REFRESH_TOKEN);             // vẫn commit
        }
        if (current.isExpired(now)) return new Rejected(INVALID_REFRESH_TOKEN);
        User user = users.findById(current.userId()).orElseThrow();
        if (user.isBlocked()) {
            refreshTokens.deleteAllByUserId(user.id());
            return new Rejected(USER_BLOCKED);                      // vẫn commit
        }
        current.revoke(now);
        refreshTokens.markRevoked(current.id(), now);
        return new Issued(issueTokens(user.id(), now));
    });
    return switch (outcome) {
        case Issued i   -> i.pair();
        case Rejected r -> throw new DomainException(r.code());
    };
}
```

### 10.7 Cửa vào HTTP (JDK `com.sun.net.httpserver`)

```java
HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
server.createContext("/", router);                                   // một context, router tự khớp path
server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
server.start();
// shutdown hook: server.stop(graceSeconds); đóng DataSource
```

```java
enum Access { PUBLIC, RIDER, INTERNAL }
@FunctionalInterface interface Handler { HttpResult handle(HttpRequest req) throws Exception; }

record HttpRequest(String method, Map<String, String> pathParams, Headers headers, byte[] body, UUID userId) {
    UUID pathUuid(String name);            // sai -> ValidationException({name: "Giá trị không hợp lệ"})
    <T> T json(Class<T> type);             // kiểm Content-Type (415) + parse (400)
}
record HttpResult(int status, Object body, Map<String, String> headers) {
    static HttpResult ok(Object body);  static HttpResult created(Object body);  static HttpResult noContent();
}

// Bảng route: một nơi duy nhất mô tả toàn bộ API
router.post  ("/auth/register",                          Access.PUBLIC,   auth::register);
router.post  ("/auth/login",                             Access.PUBLIC,   auth::login);
router.post  ("/auth/refresh",                           Access.PUBLIC,   auth::refresh);
router.post  ("/auth/logout",                            Access.PUBLIC,   auth::logout);
router.post  ("/auth/logout-all",                        Access.RIDER,    auth::logoutAll);
router.get   ("/users/me",                               Access.RIDER,    profile::get);
router.patch ("/users/me",                               Access.RIDER,    profile::update);
router.post  ("/users/me/password",                      Access.RIDER,    profile::changePassword);
router.get   ("/users/me/addresses",                     Access.RIDER,    addresses::list);
router.post  ("/users/me/addresses",                     Access.RIDER,    addresses::create);
router.put   ("/users/me/addresses/{addressId}",         Access.RIDER,    addresses::update);
router.put   ("/users/me/addresses/{addressId}/default", Access.RIDER,    addresses::setDefault);
router.delete("/users/me/addresses/{addressId}",         Access.RIDER,    addresses::delete);
router.get   ("/internal/users/{userId}",                Access.INTERNAL, internal::getUser);
router.get   ("/.well-known/jwks.json",                  Access.PUBLIC,   jwks::get);
router.get   ("/health",                                 Access.PUBLIC,   health::get);
```

Handler chỉ làm 3 việc: parse, gọi use case, map kết quả. Ví dụ:

```java
HttpResult create(HttpRequest req) {
    AddressBody body = req.json(AddressBody.class);                 // record trong adapter/http/json
    AddressView view = addresses.create(req.userId(), body.toCommand());
    return HttpResult.created(AddressJson.from(view));
}
```

`Router.handle(HttpExchange)` làm theo thứ tự ở mục 2.2 và bọc mọi thứ trong `try/catch`. Mọi exception đều đi qua **một** `ErrorMapper`:

- `ValidationException`: 400, kèm `fieldErrors`.
- `DomainException`: tra bảng `ErrorCode → HTTP status` (bảng nằm ở adapter, không nằm ở domain).
- `HttpError` (404/405/415/401/403): lỗi giao thức do adapter tự ném.
- JSON hỏng: 400.
- Còn lại: log error kèm stack trace, trả 500.

**Những điểm dễ sai với JDK HttpServer:**

- `sendResponseHeaders(status, length)`: `length = -1` nghĩa là **không có body** (dùng cho 204); `0` nghĩa là chunked. Với JSON, ghi đúng số byte.
- Luôn đóng exchange trong `finally`.
- Đọc body bằng `readNBytes(MAX_BODY_BYTES + 1)`; vượt ngưỡng thì từ chối (mã lỗi xem mục 14).
- Dùng `getRequestURI().getRawPath()` để tách segment, rồi mới decode từng segment.
- Mặc định không có timeout đọc request. Nếu service có thể bị gọi không qua gateway, đặt `-Dsun.net.httpserver.maxReqTime=30 -Dsun.net.httpserver.maxRspTime=30`.
- BCrypt tốn CPU. Với virtual thread không giới hạn, nên chặn số BCrypt chạy đồng thời bằng một `Semaphore` (khoảng số core). Gateway đã rate limit login/register, nhưng P3 và các lời gọi nội bộ thì không.

**JSON:** dùng Jackson databind (là thư viện, không phải framework):

- `FAIL_ON_UNKNOWN_PROPERTIES = false` (bỏ qua trường lạ).
- Tắt ép kiểu vô hướng (chuỗi sang số, số sang chuỗi…).
- `Instant` ghi dạng ISO; `BigDecimal` ghi dạng plain.
- Chỉ body lỗi dùng `NON_NULL` cho `fieldErrors`.

### 10.8 Lưu trữ (JDBC)

| Phương thức port | SQL |
| --- | --- |
| `existsByPhone` | `SELECT EXISTS(SELECT 1 FROM users WHERE phone_number = ?)` |
| `findByPhone` / `findById` | `SELECT id, phone_number, password_hash, full_name, avatar_url, status, created_at, updated_at FROM users WHERE … = ?` |
| `insert(User)` | `INSERT INTO users (id, phone_number, password_hash, full_name, avatar_url, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)` |
| `updateProfile` | `UPDATE users SET full_name = ?, avatar_url = ?, updated_at = ? WHERE id = ?` |
| `updatePasswordHash` | `UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ? AND password_hash = ?` (đếm số dòng cập nhật) |
| `lockForUpdate` | `SELECT 1 FROM users WHERE id = ? FOR UPDATE` |
| `insert(RefreshToken)` | `INSERT INTO user_refresh_tokens (id, user_id, token_hash, expires_at, revoked_at, created_at) VALUES (?,?,?,?,NULL,?)` |
| `findByHashForUpdate` | `SELECT id, user_id, token_hash, expires_at, revoked_at, created_at FROM user_refresh_tokens WHERE token_hash = ? FOR UPDATE` |
| `markRevoked` | `UPDATE user_refresh_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL` |
| `deleteByHash` | `DELETE FROM user_refresh_tokens WHERE token_hash = ?` |
| `deleteAllByUserId` | `DELETE FROM user_refresh_tokens WHERE user_id = ?` (trả số dòng) |
| `listByUser` | `SELECT … FROM user_addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC` |
| `findOwned` | `SELECT … FROM user_addresses WHERE id = ? AND user_id = ?` |
| `countByUser` | `SELECT count(*) FROM user_addresses WHERE user_id = ?` |
| `findNewest` | `SELECT … FROM user_addresses WHERE user_id = ? ORDER BY created_at DESC LIMIT 1` |
| `clearDefault` | `UPDATE user_addresses SET is_default = false WHERE user_id = ? AND is_default` |
| `insert(Address)` / `update` / `delete` | INSERT đủ cột / `UPDATE … SET label, address_text, lat, lng, is_default WHERE id = ?` / `DELETE … WHERE id = ?` |

`SqlErrors` đọc `SQLException.getSQLState()` và tên constraint (`PSQLException.getServerErrorMessage().getConstraint()`) để đổi thành `DomainException` theo bảng ở mục 8.

### 10.9 Bảo mật (adapter/security)

- `BCryptPasswordHasher`: dùng `at.favre.lib:bcrypt` hoặc `org.springframework.security:spring-security-crypto`. Cái sau chỉ là jar mã hoá, không kéo theo framework, và cho kết quả giống hệt v1. Thư viện chọn phải verify được `$2a$`.
- `Rs256AccessTokenIssuer` / `Rs256JwtVerifier`: tự viết bằng `java.security.Signature("SHA256withRSA")` + `Base64.getUrlEncoder().withoutPadding()` (khoảng 150 dòng), hoặc dùng `com.nimbusds:nimbus-jose-jwt`. Verifier nằm ở adapter/http (`BearerAuthenticator`), **không** là port của application: xác thực request là việc của cửa vào.
- `RsaKeys`: đọc PEM PKCS#8 bằng `KeyFactory.getInstance("RSA")` với `PKCS8EncodedKeySpec`/`X509EncodedKeySpec`, rồi tạo `JwksDocument` một lần lúc khởi động.
- `SecureRefreshTokenFactory`: một instance `SecureRandom` dùng chung; `MessageDigest.getInstance("SHA-256")` tạo mới mỗi lần vì không thread-safe; hex bằng `HexFormat.of()`.

### 10.10 Bootstrap

```java
public static void main(String[] args) throws Exception {
    AppConfig cfg = AppConfig.fromEnv(System.getenv());               // sai -> dừng ngay
    DataSource ds = DataSourceFactory.create(cfg.db());               // HikariCP
    Migrations.run(ds);                                               // Flyway, baseline như v1
    Clock clock = Clock.systemUTC();
    JdbcTransactionRunner tx = new JdbcTransactionRunner(ds);

    var users     = new JdbcUserRepository(tx);
    var sessions  = new JdbcRefreshTokenRepository(tx);
    var addresses = new JdbcAddressRepository(tx);
    var keys      = RsaKeys.load(cfg.jwt());
    var hasher    = new BCryptPasswordHasher(cfg.bcryptCost());
    var issuer    = new Rs256AccessTokenIssuer(keys.current(), cfg.jwt());
    var verifier  = new Rs256JwtVerifier(keys.all(), cfg.jwt(), clock);

    var auth    = new AuthService(users, sessions, hasher, issuer, new SecureRefreshTokenFactory(),
                                  new UuidGenerator(), tx, clock, cfg.jwt().refreshTtl());
    var profile = new ProfileService(users, tx, clock);
    var address = new AddressService(addresses, users, new UuidGenerator(), tx, clock);

    Router router = Routes.build(auth, profile, address, keys.jwks(), ds,
                                 new BearerAuthenticator(verifier),
                                 new InternalKeyAuthenticator(cfg.internalApiKey()));
    HttpServer server = UserHttpServer.start(cfg.port(), router);
    Runtime.getRuntime().addShutdownHook(new Thread(() -> { server.stop((int) cfg.shutdownGrace().toSeconds()); ds.close(); }));
}
```

### 10.11 Luồng gọi mẫu: đăng nhập

1. **[http]** `Router` khớp `POST /auth/login` (PUBLIC, bỏ qua `Authorization`), sau đó `AuthHandlers.login` parse JSON thành `LoginBody` rồi tạo `new LoginCommand(...)` (validate trường).
2. **[app]** `AuthService.login`:
   1. `PhoneNumber.parse`.
   2. `users.findByPhone` (không cần tx).
   3. `hasher.matches`; nếu không có user thì so với hash giả.
   4. Kiểm `isBlocked`.
3. **[app]** `tx.inTransaction(() -> issueTokens(userId, now))`:
   1. `refreshTokenFactory.generate()`.
   2. `RefreshToken.issue(...)`, rồi `sessions.insert`.
   3. `issuer.issue(userId, now)`, trả `TokenPair`.
4. **[http]** Map sang `TokenJson` (thêm `"tokenType": "Bearer"`), trả 200.

### 10.12 Thư viện đề xuất

| Việc | Thư viện | Bắt buộc? |
| --- | --- | --- |
| Driver DB | `org.postgresql:postgresql` (bản mới, đã bỏ `synchronized` nên hợp với virtual thread) | có |
| Connection pool | `com.zaxxer:HikariCP` (≥ 5.1) | nên có |
| Migration | `org.flywaydb:flyway-core` + `flyway-database-postgresql` | nên có (giữ lịch sử v1) |
| JSON | `com.fasterxml.jackson.core:jackson-databind` + `jackson-datatype-jsr310` | nên có |
| BCrypt | `at.favre.lib:bcrypt` hoặc `spring-security-crypto` | có |
| JWT | tự viết, hoặc `com.nimbusds:nimbus-jose-jwt` | tuỳ |
| Log | `org.slf4j:slf4j-api` + `ch.qos.logback:logback-classic` | nên có |
| Test | JUnit 5, AssertJ, `org.testcontainers:postgresql` | — |
| Đóng gói | `maven-shade-plugin`, chạy bằng `java -jar` | — |

---

## 11. Kiểm thử

| Tầng | Cách test | Ghi chú |
| --- | --- | --- |
| domain | Unit test thuần | `PhoneNumber` (bảng ví dụ BR-01), `FieldErrors`, `RefreshToken`, `AddressRules` |
| application | Unit test với **fake in-memory** cho mọi port | `TransactionRunner` giả gọi thẳng `work.get()`. Chuyển gần như toàn bộ test service của v1 sang đây, không cần Mockito |
| persistence | Testcontainers PostgreSQL, chạy migration thật | `FOR UPDATE` thật sự chặn request thứ hai; partial unique index; đổi constraint sang mã lỗi; độ chính xác micro giây |
| http | Chạy `HttpServer` ở cổng 0 với service thật + fake repo, gọi bằng `java.net.http.HttpClient` | Thứ tự lỗi ở mục 2.2; header no-store; 204 không có body; bỏ qua `Authorization` ở route PUBLIC |
| end-to-end | Postman collection `Chande-user-service` | Phải **sửa path** (bỏ `/users` trong `/api/v1/users/auth/...`, hoặc gọi qua gateway) và sửa bước "Đổi mật khẩu" (giờ phải đăng nhập lại) |

Các ca từ test v1 cần giữ:

- **Đăng ký:** chuẩn hoá SĐT và băm mật khẩu; SĐT trùng thì 409 mà **không băm**; SĐT sai bị chặn **trước khi chạm DB**; hai request trùng cùng lúc thì 409.
- **Đăng nhập:**
  - DB chỉ lưu hash của refresh token.
  - SĐT lạ trả 401 (có chạy BCrypt với hash giả); sai mật khẩu trả 401.
  - Bị khoá + đúng mật khẩu trả 403; bị khoá + sai mật khẩu trả 401.
- **Refresh:** hợp lệ thì xoay vòng; dùng lại token thì xoá hết; hết hạn thì **không** xoá hết; token lạ trả 401; user bị khoá thì xoá hết và trả 403.
- **Logout / logout-all:** token lạ không lỗi; logout-all xoá hết.
- **Đổi mật khẩu:** thành công thì xoá hết phiên (v2 không cấp token mới); sai mật khẩu cũ thì không đổi gì; mật khẩu mới trùng mật khẩu cũ thì lỗi; user không tồn tại thì 404.
- **Hồ sơ:** chỉ sửa `fullName` thì avatar giữ nguyên; body rỗng thì không đổi gì.
- **Địa chỉ:**
  - Địa chỉ đầu tiên thành mặc định và được chuẩn hoá; địa chỉ thứ hai không cờ thì không mặc định.
  - Quá 10 địa chỉ bị từ chối.
  - Update có `makeDefault` thì bỏ mặc định cũ **trước**; `setDefault` địa chỉ của người khác trả 404.
  - Xoá địa chỉ mặc định thì địa chỉ mới nhất lên thay; xoá địa chỉ thường thì không đổi mặc định.
- **Nội bộ:** đúng khoá thì 200; thiếu khoá, sai khoá hoặc chỉ có JWT thì 401; khoá nội bộ gọi `/users/me` thì 401.
- **JWT:** đúng claim; sai chữ ký, hết hạn, sai issuer đều bị từ chối. Thêm: `alg=none`/`HS256` bị từ chối, `kid` lạ bị từ chối.

---

## 12. Khác biệt v1 → v2

| Hạng mục | v1 | v2 |
| --- | --- | --- |
| Nền tảng | Spring Boot 4.1.1 (WebMVC, Security, Data JPA, Validation, Actuator) | JDK HttpServer + JDBC, nối tay |
| Cổng | 8081 | 3011 |
| Path auth | `/api/v1/users/auth/*` | `/auth/*` |
| Path hồ sơ/địa chỉ | `/api/v1/users/me…` | `/users/me…` |
| Ký JWT | HS256, secret dùng chung, `iss = "user-service"` | RS256 + `kid`, JWKS, `iss` lấy từ cấu hình, thêm `jti` |
| Logout | Cần JWT, kiểm chủ sở hữu token | Không cần JWT |
| Đổi mật khẩu | Trả cặp token mới | Trả `{"passwordChanged": true}`, phải đăng nhập lại |
| Health | `/actuator/health` | `/health` |
| `UserStatus` | ACTIVE, BLOCKED, PENDING | ACTIVE, BLOCKED |
| Path lạ khi không có token | 401 | 404 |
| Kiểu JSON | Jackson mặc định của Spring | Bỏ qua trường lạ, **không** ép kiểu |
| Message `lng` | "Vĩ kinh phải từ…" | "Kinh độ phải từ…" (đề xuất) |
| Tạo địa chỉ đồng thời | Có thể vượt 10 | Khoá dòng user |
| Đổi mật khẩu đồng thời | Không xử lý | So-sánh-rồi-ghi, `DATA_CONFLICT` |
| Thông tin DB | Hard-code trong yaml | Biến môi trường |

**Các bước chuyển:**

1. Chạy v2 ở cổng 3011, dùng chung DB với v1 (migration không đổi).
2. Sinh cặp khoá RSA; đặt `JWT_ISSUER` trùng `RIDER_JWT_ISSUER` của gateway.
3. Trỏ `USER_SERVICE_URLS` và `RIDER_JWKS_URI` của gateway sang v2.
4. App gặp 401 với access token HS256 cũ thì refresh. Refresh token vẫn hợp lệ nên người dùng không phải đăng nhập lại.

---

## 13. Hành vi v1 cần biết khi viết lại

- Refresh token đã xoay vòng và đã hết hạn **không bao giờ bị dọn**; bảng `user_refresh_tokens` lớn dần. Xem mục 14.
- Chưa có API khoá tài khoản; muốn khoá phải `UPDATE users SET status = 'BLOCKED'`.
- BCrypt chỉ dùng **72 byte** đầu, trong khi v1 kiểm **72 ký tự**. Mật khẩu tiếng Việt có dấu (2–3 byte/ký tự) có thể vượt 72 byte.
- `full_name varchar(100)` trong PostgreSQL đếm theo ký tự, còn `String.length()` đếm UTF-16 (emoji tính 2). Kiểm ở Java vì vậy chặt hơn DB, chấp nhận được.
- Endpoint RIDER không kiểm `status`: user bị khoá vẫn gọi được tới khi access token hết hạn.

---

## 14. Điểm còn mở (cần chốt trước hoặc trong lúc code)

1. **Claim `aud`:** gateway hiện chưa yêu cầu `aud` cho token RIDER, nhưng contract Trip có kiểm audience. Cần chốt có thêm `aud: ["trip-service", …]` không (đề xuất cấu hình được qua `JWT_AUDIENCE`, mặc định để trống).
2. **Hai định dạng lỗi:** lỗi do gateway trả có dạng `{error:{code,message,details},meta}`, còn lỗi do service trả có dạng `{code,message,fieldErrors}`. App phải xử lý cả hai, hoặc sau này chuyển service sang envelope.
3. **Route OTP/quên mật khẩu** đang khai báo public ở gateway nhưng v2 không có. Có thể giữ nguyên (service trả 404) hoặc bỏ khỏi `PublicEndpoints`.
4. **Dọn refresh token:** đề xuất xoá các dòng có `expires_at < now - 1 ngày` bằng một tác vụ định kỳ trong process (`ScheduledExecutorService`), hoặc dọn luôn mỗi lần đăng nhập của user đó.
5. **Body quá lớn:** v1 không có mã lỗi cho trường hợp này. Đề xuất thêm `PAYLOAD_TOO_LARGE` (413), hoặc dùng 400 `VALIDATION_ERROR` để không thêm mã mới.
6. **Giới hạn 72 byte của BCrypt:** đề xuất kiểm thêm `password.getBytes(UTF_8).length ≤ 72` và trả lỗi validation với message riêng.
7. **`NOT_ACCEPTABLE` (406):** giữ như v1 hay bỏ (luôn trả JSON).
