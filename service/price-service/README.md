# Price Service — thiết kế v1 đơn giản

Ngày 06/10/2026: đã triển khai API tính giá mở cửa, policy/config riêng CAR/BIKE, kiểm thử và Docker. Tiền VND dùng BigInt và serialize chuỗi. Trip gọi API qua HTTP, không gộp runtime hai service.

- [Thiết kế và nghiệp vụ](docs/thiet-ke-v1.md)
- [Cấu hình biểu giá mẫu](config/fare-policy.example.json): CAR 12.000đ/1 km đầu + 10.000đ/km vượt; BIKE 8.000đ/1 km đầu + 4.000đ/km vượt. Đây là fixture phát triển, không phải giá kinh doanh được duyệt.
- [API và deploy](docs/api.md)

Từ service root: tạo `.env` từ example nếu chưa có, đặt `PRICE_TRIP_TOKEN` khớp `PRICING_TOKEN` của Trip rồi chạy `npm ci`, `npm run start:dev`. Production build: `npm run build`, `npm run start:prod`. Local port 3005; `/docs` và `/openapi.json` chỉ bật development nếu SWAGGER_ENABLED=true.

`npm run test:all`: 6 tests đạt (policy/config và HTTP). `config/fare-policy.mock.json` khai báo MOCK_BIKE explicit cho local integration; không fallback từ mã xe lạ. Config local `config/fare-policy.json` và `.env` được ignore; đổi cấu hình rồi restart để tạo policy snapshot mới, các quote đã lưu ở Trip không đổi.

Stack Node.js 24 + TypeScript 5.9 + NestJS 11/Zod 4, cùng Trip/Routing. Controller → Calculate Fare → Fare Policy; không cần database hoặc external client.
