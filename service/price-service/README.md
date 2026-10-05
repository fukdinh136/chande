# Price Service — thiết kế v1 đơn giản

Yêu cầu ngày 06/10/2026: tính giá kiểu mở cửa taxi, hai nhánh CAR/BIKE. Người dùng cho phép đặt giá mẫu tùy chọn và yêu cầu các thuộc tính sửa được. Bản này ghi thiết kế/config; chưa có HTTP runtime.

- [Thiết kế và nghiệp vụ](docs/thiet-ke-v1.md)
- [Cấu hình biểu giá mẫu](config/fare-policy.example.json): CAR 12.000đ/1 km đầu + 10.000đ/km vượt; BIKE 8.000đ/1 km đầu + 4.000đ/km vượt. Đây là fixture phát triển, không phải giá kinh doanh được duyệt.

Đề xuất cùng stack Node.js 24 + TypeScript 5.9 + NestJS 11/Zod 4 với Trip/Routing. Controller → Calculate Fare → Fare Policy; không cần database hoặc external client cho phép tính v1.
