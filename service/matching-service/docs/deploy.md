# Deploy

Matching API mặc định 3007. Local tích hợp dùng Driver 3008, Realtime 3009 để tránh Trip mock 3003 và Routing 3004. Một worker, hai job async đồng thời; polling 5 giây, expiry scan 1 giây; retry 1–30 giây có jitter.

Copy .env.example ra .env và điền credential riêng; không commit env/key. Node 24: npm ci, npm run build, npm run migration:run, npm run start:prod; worker chạy npm run worker:prod. Migration là lệnh riêng trước API/worker, không synchronize schema.

PostgreSQL riêng cho Matching; Redis của Driver/Realtime do từng service sở hữu; RabbitMQ có volume riêng. Không xóa volume existing. CAR_4/CAR_7 dùng graph OSRM Hà Nội hiện có. Không cấu hình BIKE real bằng profile bicycle/car.

Readiness kiểm tra schema/database. Worker và consumer reconnect có backoff; không trả thành công khi durable write thất bại. Requeue outbox giữ eventId và không đổi expiresAt. DLQ chỉ replay sau khi sửa payload/nguyên nhân, kiểm tra terminal state trước giao.

V1 một Realtime replica. Mở rộng nhiều replica cần Socket.IO adapter/room delivery và limiter toàn cụm. Hosting production, GPS traffic và OSRM BIKE ngoài nghiệm thu.
