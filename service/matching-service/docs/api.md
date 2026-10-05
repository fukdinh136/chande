# API và routes

Response `{data,meta:{requestId}}`; lỗi `{error:{code,message},meta:{requestId}}`. X-Request-Id UUID được giữ qua service. Body strict, giới hạn 64 KiB. Service credential riêng cho Trip, Driver và Realtime; không proxy internal qua Gateway.

| Method/path | Auth | Status/data |
|---|---|---|
| POST /internal/matching/requests | Trip X-Service-Token | 202 `{commandId,accepted:true}` sau transaction |
| POST /internal/matching/requests/:tripId/cancel | Trip token | 202 `{commandId,accepted:true}` |
| POST /internal/events/trips | Trip token | 202 event receipt |
| POST /internal/matching/reservations/batch | Driver token | 200 `{items:[{driverId,tripId:null\|UUID}]}` |
| GET /internal/matching/offers/:offerId | Realtime token | 200 offer/current status |
| GET /internal/matching/drivers/:driverId/offer | Realtime token | 200 offer hoặc null |
| GET /matching/offers/active | JWT DRIVER | 200 offer hoặc null |
| GET /matching/offers/:offerId | JWT DRIVER | 200 chính driver được mời |
| POST /matching/offers/:offerId/accept | JWT DRIVER + UUID Idempotency-Key | 202 decision đã lưu |
| POST /matching/offers/:offerId/decline | JWT DRIVER + UUID Idempotency-Key | 200 decision đã lưu |
| GET /health/live, /health/ready | none | liveness/readiness |

Accept/decline body `{}`. Sai quyền 403; không tồn tại 404; offer đóng/hết hạn hoặc key dùng lại payload khác 409; dependency lỗi 503. Retry decision cùng key trả receipt đã lưu, không thực thi lại.

Search command dùng contract Trip hiện có: commandId/type/tripId/tripVersion/occurredAt/riderId/pickup/destination/vehicleType/route/fare. Cancel và completion giữ terminal marker kể cả không có search.

Rabbit event `DRIVER_TRIP_OFFER`: eventId, offerId, driverId, tripId, version, status, expiresAt. Event cập nhật `DRIVER_TRIP_OFFER_UPDATED` dùng cùng offerId và version tăng. Realtime truy vấn Matching để lấy trạng thái hiện tại và dữ liệu pickup/destination/vehicleType/fare; không dùng payload cũ để hồi sinh offer. Socket emits `driver.trip.offer` / `driver.trip.offer.updated` với `{data:<offer>}`; room driverId được lấy từ JWT. REST decision trả `{offerId,status,accepted}`; decline có accepted=false và status=DECLINED.

Trip bổ sung POST /internal/trips/active-drivers/batch (Driver token) và GET /internal/trips/:id/matching-state (Matching token). Callback POST /internal/trips/:id/assignment trả 202 sau commit.
