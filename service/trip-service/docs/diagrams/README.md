# Bản vẽ C4 Trip Service

Chín file SVG được xuất từ các block Mermaid trong [c4.md](../c4.md), theo thứ tự trong tài liệu. Chỉnh sửa tại `c4.md`, sau đó xuất lại SVG; không sửa nội dung SVG bằng tay.

Lần xuất ngày 05/10/2026 dùng Mermaid CLI 12.0.0 và Edge headless trên Windows. [Mermaid CLI](https://github.com/mermaid-js/mermaid-cli) hỗ trợ xuất SVG/PNG/PDF. Công cụ render không được thêm vào dependency runtime của Trip.

## Xuất lại

Chuẩn bị Mermaid CLI 12.0.0 ở thư mục công cụ riêng và browser tương thích Puppeteer. Từ thư mục `service/trip-service`, chạy:

```powershell
node docs/diagrams/render.mjs 'C:\path\to\node_modules\@mermaid-js\mermaid-cli\src\cli.js' 'C:\path\to\puppeteer.json'
```

`puppeteer.json` chỉ định browser có sẵn, ví dụ:

```json
{
  "executablePath": "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "headless": true,
  "args": ["--disable-gpu"]
}
```

Có thể bỏ tham số thứ hai nếu Puppeteer đã có browser mặc định. `render.mjs` dùng thư mục Temp riêng để tạo input, render tuần tự, dọn input tạm sau khi chạy và chỉ ghi chín SVG trong thư mục này. Cấu hình màu/font nằm trong [mermaid.json](mermaid.json). SVG dùng font hệ thống Segoe UI/Arial và nền trắng.

Khi thêm/xóa/đổi thứ tự Mermaid block, cập nhật bảng ánh xạ trong `render.mjs` và link trong `c4.md` trước khi render. Probe/luồng nghiệp vụ của service không được gọi bởi script xuất sơ đồ.
