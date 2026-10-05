# API Price Service

Ngày 06/10/2026. POST `/internal/fares/estimate` đã triển khai, tương thích PricingClient của Trip. Local port 3005. Chỉ Trip dùng service token, endpoint private. Không thêm `/fare/calculate` alias.

Headers: `X-Service-Token` khớp `PRICE_TRIP_TOKEN`; `X-Request-Id` UUID tùy chọn. Server sinh UUID khi thiếu, từ chối ID sai. JSON strict, body tối đa 64 KiB, Cache-Control no-store.

```json
{"route":{"distanceMeters":4000,"durationSeconds":600},"vehicleType":"CAR"}
```

```json
{"data":{"currency":"VND","amount":"42000","breakdown":[{"code":"BASE_FARE","amount":"12000"},{"code":"DISTANCE_FARE","amount":"30000"}]},"meta":{"requestId":"90000000-0000-4000-8000-000000000001"}}
```

Distance/duration là số nguyên không âm ≤2147483647; ETA không cộng phụ phí thời gian ở distance mode. Phần vượt số mét mở cửa tính theo mét, làm tròn lên 1 VND. Tổng tiền/đơn giá dùng BigInt, cap BIGINT PostgreSQL; breakdown phải cộng đúng tổng. [Thiết kế](thiet-ke-v1.md).

Lỗi dùng `{error:{code,message,details:[]},meta:{requestId}}`, message=code, không trả stack/raw config. 400 INVALID_REQUEST/UNSUPPORTED_VEHICLE_TYPE, 401 INVALID_SERVICE_CREDENTIAL, 413 INVALID_REQUEST cho body lớn, 503 INVALID_FARE khi phép tính vượt cap, 500 INTERNAL_ERROR cho lỗi ngoài dự kiến. Trip ánh xạ dependency lỗi thành 503 DEPENDENCY_UNAVAILABLE và không lưu quote.

GET `/health/live`, `/health/ready` không gọi dependency. `/docs`, `/openapi.json` có schema request/response khi bật Swagger ngoài production.

## Cấu hình/deploy

- `HOST`, `PORT=3005`, `PRICE_TRIP_TOKEN` hoặc `PRICE_TRIP_TOKEN_FILE` (không đặt cả hai).
- `SUPPORTED_VEHICLE_TYPES=CAR,BIKE`, `FARE_POLICY_FILE=config/fare-policy.example.json`. Loader validate biểu giá trước startup; không hard-code vào hàm tính.
- `SWAGGER_ENABLED=true|false`; production tắt docs và từ chối enabled MOCK_BIKE.
- Docker build từ service root; Node 24 image pin digest, multi-stage, non-root, không bake env/secrets/local config. Production mount policy file và secret file rồi chọn đường dẫn trong container.
- Local tích hợp dùng [Trip Compose](../../trip-service/compose.local.yml), policy mock có CAR/BIKE/MOCK_BIKE explicit. Không triển khai User/Driver/Matching trong package này.
