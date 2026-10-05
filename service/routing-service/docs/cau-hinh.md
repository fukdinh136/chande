# Cấu hình Routing và OSRM

Ngày cập nhật: 06/10/2026. Provider **OSRM đã được người dùng chọn**. Config loader đã triển khai ở [config.ts](../src/bootstrap/config.ts) và kiểm thử: Node.js 24 + TypeScript 5.9 + NestJS 11, Zod 4 và dotenv/`process.env`. Không ghi đè file local. Runtime chặn real Realtime khi chưa có adapter wire được xác nhận.

## 1. File bạn cần sửa

Mở `service/routing-service/.env`. File được Git ignore; `.env.example` dùng để chia sẻ cấu hình và luôn để credential trống.

```dotenv
EXTERNAL_MAP_PROVIDER=osrm
EXTERNAL_MAP_BASE_URL=
EXTERNAL_MAP_AUTH_MODE=none
EXTERNAL_MAP_API_KEY=
INTEGRATION_MODE=mock
```

Điền URL server OSRM của bạn. OSRM gốc không định nghĩa API key trong [HTTP API](https://project-osrm.org/docs/v5.24.0/api/); giữ key trống và auth `none`. Nếu endpoint đi qua proxy có xác thực, cấu hình theo contract proxy:

```dotenv
EXTERNAL_MAP_AUTH_MODE=header
EXTERNAL_MAP_API_KEY=your_proxy_key
EXTERNAL_MAP_API_KEY_HEADER=X-API-Key
```

Tên header là ví dụ. Thiết kế v1 chỉ hỗ trợ header chứa key trực tiếp; Bearer/OAuth/query auth cần adapter auth riêng. Mode mock không gửi request OSRM dù đã điền key. Auth none không gửi key.

Ví dụ server local, có hiệu lực sau khi có runtime:

```dotenv
EXTERNAL_MAP_BASE_URL=http://127.0.0.1:5000
EXTERNAL_MAP_ALLOWED_HOSTS=127.0.0.1,localhost,osrm
EXTERNAL_MAP_ALLOW_HTTP=true
```

Docker dùng DNS service, ví dụ `http://osrm:5000`, thay vì localhost của Routing container. HTTP chỉ bật tường minh cho mạng local/private tin cậy; header auth yêu cầu HTTPS. Không chấp nhận userinfo/query/hash hoặc operation path trong base URL. Allowlist áp dụng cả URL mặc định và URL theo profile; không theo redirect. Không chọn public demo mặc định.

## 2. Biến cấu hình dự kiến

| Nhóm | Biến / mặc định | Validation / ý nghĩa |
| --- | --- | --- |
| Runtime | `APP_ENV=development`, `HOST=127.0.0.1`, `PORT=3004`, `LOG_LEVEL=INFO` | Enum env/log; port 1–65535; production bind mạng backend |
| Mode/provider | `INTEGRATION_MODE=mock`, `EXTERNAL_MAP_PROVIDER=osrm` | Production cấm mock; real yêu cầu adapter OSRM |
| Provider auth | `EXTERNAL_MAP_AUTH_MODE=none`, `EXTERNAL_MAP_API_KEY_HEADER=X-API-Key` | Enum none/header; cấm header reserved Host/Content-Length và CR/LF |
| Provider secret | `EXTERNAL_MAP_API_KEY` hoặc `_FILE` | Không cùng đặt hai nguồn; header mode yêu cầu key; none không gửi key |
| Endpoint | `EXTERNAL_MAP_BASE_URL` trống, `EXTERNAL_MAP_ALLOWED_HOSTS=127.0.0.1,localhost,osrm`, `EXTERNAL_MAP_ALLOW_HTTP=false` | Real cần endpoint cho mọi enabled profile; HTTPS mặc định; private HTTP opt-in, không kèm key |
| Caller auth | `ROUTING_TRIP_TOKEN`, `ROUTING_MATCHING_TOKEN`, `ROUTING_GATEWAY_TOKEN`, từng `_FILE` | Token riêng/bắt buộc/khác nhau; Trip token khớp `ROUTING_TOKEN` phía Trip |
| Vehicle mapping | `SUPPORTED_VEHICLE_TYPES=MOCK_BIKE`, `VEHICLE_PROFILES_FILE=config/vehicle-profiles.json` | Enabled codes có mapping; real từ chối mock profile |
| Deadline | `REQUEST_DEADLINE_MS=4000` | Realtime lookup + queue/rate/map call/retry/serialize cùng budget; nhỏ hơn timeout caller, Trip hiện 5000 ms |
| Upstream | `UPSTREAM_TIMEOUT_MS=1200`, `UPSTREAM_MAX_ATTEMPTS=2`, `UPSTREAM_RETRY_BASE_MS=100`, `UPSTREAM_MAX_RESPONSE_BYTES=1048576` | Hai attempts tổng; từng attempt/backoff không vượt budget còn lại |
| Queue | `QUEUE_MAX_SIZE=50`, `QUEUE_ADMISSION_TIMEOUT_MS=100`, `ROUTING_JOB_MAX_WAIT_MS=500` | Bounded; timeout enqueue khác tuổi job |
| Workers | `WORKER_POOL_SIZE=2` | Tối đa hai job async đang xử lý trong một Node process; mọi job dùng chung queue/limiter singleton |
| Request limit | `RATE_LIMIT_REQUESTS_PER_SECOND=2`, `RATE_LIMIT_BURST=2`, `RATE_LIMIT_WAIT_TIMEOUT_MS=250` | Mọi attempt xin permit; defaults bảo vệ tải server riêng, không phải quyền gọi public demo |
| Matrix limit | `RATE_LIMIT_MATRIX_ELEMENTS_PER_MINUTE=100`, `MATRIX_MAX_CANDIDATES=25`, `MATRIX_BATCH_MAX_ELEMENTS=25` | Cap số driver locations từ Realtime; vượt cap trả ROUTING_BUSY trước map call, không cắt; budget N×1 và giới hạn server/URL/N+1 tọa độ |
| Shutdown | `SHUTDOWN_GRACE_MS=5000` | Đóng admission, drain hữu hạn rồi fail/cancel việc còn lại |
| Realtime mode / URL | `REALTIME_INTEGRATION_MODE=mock`, `REALTIME_BASE_URL` trống | Mode riêng OSRM; real cần endpoint và wire contract được xác nhận |
| Realtime credential | `REALTIME_TOKEN` hoặc `REALTIME_TOKEN_FILE` | Credential outbound riêng; không dùng map key/inbound token; auth mapping theo Realtime contract |
| Realtime timeout / response | `REALTIME_TIMEOUT_MS=1000`, `REALTIME_MAX_RESPONSE_BYTES=1048576` | Timeout không vượt deadline còn lại; response cap; không đổi lỗi thành empty list |
| Nearby radius | `NEARBY_DRIVER_RADIUS_METERS=2000` | V1 cố định 2 km, validate literal 2000; semantics địa lý cần Realtime xác nhận |

Numeric là integer dương, có upper bound trong settings; không cho queue size 0 thành vô hạn. Boolean chỉ nhận true/false; profile path segment không nhận slash/query. Defaults là đề xuất để review, chưa là SLO/capacity đã đo.

F00 đọc `.env` từ service root, sau đó biến process env ghi đè dotenv; validate sau merge. Secret file là nguồn được chọn qua `_FILE`, không tự ghi đè inline và không cho đặt cùng hai nguồn. Loader chuyển string env sang kiểu dữ liệu rồi validate bằng Zod; không coi chuỗi `false` là truthy. File local hiện có được giữ nguyên khi cập nhật tài liệu.

## 3. Vehicle profiles và endpoint

`config/vehicle-profiles.json` local được sao chép từ mẫu:

```json
{
  "schemaVersion": 1,
  "vehicleTypes": {
    "MOCK_BIKE": {"profile": "mock_motorcycle", "baseUrl": null},
    "BIKE": {"profile": null, "baseUrl": null},
    "CAR": {"profile": "driving", "baseUrl": null}
  }
}
```

BIKE/CAR là mã dự án minh họa; enum thật cần thống nhất với Trip/Matching. `baseUrl=null` dùng URL mặc định; URL riêng dành cho server có dataset/profile khác. Chỉ bật CAR real khi endpoint phục vụ dataset ô tô đã kiểm tra. BIKE giữ null để tránh bật xe máy với profile không phù hợp. Profile xe đạp của OSRM dành cho bicycle; xem [bicycle.lua](https://github.com/Project-OSRM/osrm-backend/blob/master/profiles/bicycle.lua).

Tên profile trong URL không chứng minh loại dataset. Mỗi mapping cần ghi nhận endpoint, dataset/profile build và acceptance cho loại xe đó theo [kế hoạch](ke-hoach-phat-trien.md). Không fallback xe máy sang ô tô; không tải/preprocess dataset trong task tài liệu này.

## 4. Secrets và fail-fast

Production có thể dùng `EXTERNAL_MAP_API_KEY_FILE=/run/secrets/external-map-api-key` với header auth; tương tự ba caller token files. Không đặt cả inline và file. Loader đọc UTF-8/trim; thiếu file hoặc key rỗng ở header mode làm startup lỗi. Không copy `.env`/secrets vào image hoặc log. `.env`, `secrets/` và profile local đều Git ignored.

Real OSRM auth none **không bắt buộc key**. Startup fail-fast nếu thiếu endpoint, enabled profile null hoặc transport/host sai. Capability server không tự detect khi startup; response thiếu/sai bị adapter từ chối khi gọi. Readiness kiểm tra nội bộ, không gọi OSRM mỗi probe; synthetic route check là tác vụ vận hành riêng.

## 5. Những điểm còn cần chốt

Server tự host hay hosting có proxy; vùng dữ liệu; profile xe máy; version/algorithm và capability Table distance; resource budget; chu kỳ cập nhật dataset; tải cho phép; attribution. V1 không cam kết traffic realtime. [Traffic documentation](https://github.com/Project-OSRM/osrm-backend/wiki/Traffic) mô tả việc nạp speed updates, không cung cấp sẵn nguồn traffic cho hệ thống này.

## 6. Realtime Client

Client nằm trong Routing; mẫu `.env.example` đã có nhóm REALTIME và bán kính 2000 m. File `.env` local hiện có được giữ nguyên; bổ sung các biến mới từ example khi triển khai F11, không ghi đè map key/caller token đã điền.

`INTEGRATION_MODE` hiện dành cho OSRM; `REALTIME_INTEGRATION_MODE` chọn mock/real riêng. Real Realtime validate URL tin cậy, credential inline/file đúng một nguồn, không redirect; production dùng HTTPS, local/private HTTP chỉ theo contract/mạng được duyệt. Client không gửi map key hoặc token inbound. Wire endpoint/header xác thực và freshness policy cần chốt theo Realtime; xem [Realtime Client](realtime-client.md). Readiness không gọi network Realtime.

R03 ETA Matrix gọi Realtime Client trước OSRM. REALTIME_TIMEOUT_MS là timeout lookup, luôn cắt theo deadline còn lại; không reset REQUEST_DEADLINE_MS khi nhận snapshot. Mode mock cho mỗi dependency cho phép test luồng lookup→matrix bằng fake upstreams mà chưa cần Matching.
