# Báo cáo tích hợp backend và deployment

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Toàn hệ thống |
| Rà soát | 2026-10-06 |
| Quy ước | [Format và số liệu](quy-uoc-tai-lieu.md) |

## Thay đổi

Gateway có proxy Matching DRIVER-only, Routing /routes và /routes/recalculate ở cổng 3004 với credential cấu hình server; client không spoof token upstream hoặc gọi matrix/internal. CORS expose Idempotent-Replay; whitelist User auth v2 bỏ OTP/reset chưa tồn tại. Kiểm thử role/headers/scopes và record constructor binding đã bổ sung.

Dockerfile User/Gateway multi-stage Java 21 và tám image backend đã build. Stack chung có User issuer thật, Driver JWT thật, Gateway Redis event receiver, Routing OSRM Hà Nội, Price, Matching, Realtime, PostgreSQL/Rabbit/Redis và ingress Nginx. Không dùng RIDER mock issuer hoặc Gateway mock sink trong smoke mới.

Generator/runner tạo private config, stable RSA keys, isolated volumes/PVC, migration jobs, health/startup probes, resource limits và loopback endpoints; không sửa .env/key/token hoặc volume của các stack cũ. Graph OSRM read-only, không tải/cắt lại dữ liệu trong đợt này.

## Bằng chứng thực chạy

| Check | Kết quả |
| --- | --- |
| Gateway Maven verify | 75 tests pass, 0 fail/error/skip, gồm 5 Redis → WebSocket tests |
| Topology test | node --test deploy/stack.test.cjs pass |
| Docker | Tám image build; chande-backend runtime healthy; smoke qua :18080 pass |
| Kubernetes | docker-desktop v1.34.1; chande-local; 15 deployment Ready, 2 migration jobs Complete, 3 PVC Bound |
| Manifest | Server dry-run pass trước apply; private generated files Git ignored |
| Smoke Kube | Cùng luồng qua port-forward :18081 pass |

| Môi trường | Loại xe | Trip | Kết thúc | Tuyến / quote |
| --- | --- | --- | --- | --- |
| Docker | CAR_4 | c416ea77-ad47-4223-8f3d-6503a3d94402 | COMPLETED | 2546 m / 27460 VND, final bằng quote |
| Docker | CAR_7 | 06d15b63-725e-41f6-94eb-1bd87ac83f97 | CANCELLED | 2546 m / 27460 VND quote, final null |
| Kubernetes | CAR_4 | b0f26038-d11f-412a-8785-91f87b649b91 | COMPLETED | 2546 m / 27460 VND, final bằng quote |
| Kubernetes | CAR_7 | 4c582f17-95e0-431b-8e34-2af27e33a37c | CANCELLED | 2546 m / 27460 VND quote, final null |

Smoke tạo User thật/register/login/profile, đăng nhập Driver, chọn xe/ONLINE, gửi GPS qua Socket.IO ingress, gọi Routing public bằng token inject của Gateway, Trip estimate/create/replay, nhận offer, accept REST qua Gateway, nhận trip.assigned qua Gateway /ws/Redis, hoàn thành/hủy và xác nhận AVAILABLE/reservation release. RIDER đọc offer bị 403, public matrix 403, internal path tại ingress 404. CORS/replay header và giá immutable được assert.

## Restart và phạm vi

Restart-check đã pass: giữ token RIDER/DRIVER trước restart, restart User/Gateway/Driver/Realtime/Matching worker rồi kiểm lại profile/account và JWT. Năm deployment Ready trở lại; signing files/Secret giữ nguyên, không rebuild key mỗi startup. Không restart PostgreSQL/Rabbit/Redis hoặc khẳng định HA từ check này.

Đã deploy **local Docker Desktop**, chưa deploy Internet/cloud. OTP Driver vẫn mock local 123456; BIKE OSRM thật, push/SMS/email, UI thiết bị và HA/production chưa nghiệm thu. Notification delivery local dùng chung durable Gateway receiver, không phải Notification service riêng. PostgreSQL local chia bốn DB/role trên một instance; fixture Driver không thay thế DDL production.

Báo cáo validation 455 tests trước đó là snapshot trước tích hợp, không đổi số lịch sử; Gateway hiện tăng 73→75, có thêm topology test. Checks local không đồng nhất với CI remote. Image/config/namespace mới giữ các stack Trip/Matching/OSRM trước đó.

Commits: `4f38084` — Gateway proxy/security/CORS; `01f87ba` — Docker/Kubernetes, smoke, restart, CI và Dockerfile. Tài liệu/validation được commit riêng sau hai feature runtime.

Runbook và cách chạy lại: [deploy backend](deploy-backend.md). Contract hiện tại: [bảng liên service](hop-dong-lien-service.md). CI kết quả remote được ghi riêng khi kiểm tra được workflow của commit đã push.
