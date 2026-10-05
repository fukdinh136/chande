# Quy ước tài liệu service

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Toàn hệ thống |
| Rà soát | 2026-10-06 |
| Quy ước | [Format và số liệu](quy-uoc-tai-lieu.md) |

Áp dụng cho README và tài liệu Markdown của tám service trong `service/`. Giữ nghiệp vụ và contract đã triển khai; khác biệt có chủ ý giữa các service phải ghi rõ.

## Format

- UTF-8 không BOM, newline LF; một tiêu đề H1, H2/H3 cho các phần; có dòng trống quanh heading, bảng, danh sách và code block.
- Đầu file có bảng `Thuộc tính / Giá trị`: Service, Rà soát theo `YYYY-MM-DD`, liên kết quy ước. Ngày rà soát không thay ngày của kết quả kiểm thử lịch sử.
- Link local tương đối, không phụ thuộc ổ C hoặc Downloads. README chứa mục lục; API, nghiệp vụ, kiến trúc, routes, deploy và báo cáo dùng chung quy ước này.
- Bảng API ghi method/path, caller/auth, status và payload. Đường dẫn cấu hình/source đặt trong code hoặc link; mẫu JSON phải parse được, pseudocode dùng fence `text`.
- Lệnh Windows dùng `powershell` và `npm.cmd`/`mvnw.cmd`; lệnh Linux dùng `bash`. Ví dụ địa lý tổng hợp được ghi rõ, không thay số đo lịch sử bằng tọa độ Hà Nội.

## Số liệu và nguồn đối chiếu

Đơn vị wire: mét, giây, tiền VND nguyên dạng chuỗi, timestamp ISO-8601 UTC. Biến có hậu tố `_MS` dùng millisecond. JSON giữ số ASCII không phân tách nghìn; văn bản có thể ghi `2 km (2000 m)`, `20 giây (20000 ms)`, `27460 VND` để tránh nhầm đơn vị.

[Hợp đồng liên service](hop-dong-lien-service.md) phân biệt **default runtime**, **override trong compose**, **fixture/mock**, **kết quả đo** và **mục tiêu chưa triển khai**. Cổng Realtime và Routing cùng default 3004 là xung đột cấu hình cần override, không phải hai service đã cùng listen thành công trên một host.

Nguồn có thẩm quyền: quyết định người dùng → source/loader, route/schema và config mẫu đã commit → compose thực chạy → kết quả kiểm thử có ngày/command. Khóa/token và `.env` private không được đọc vào báo cáo. Phiên bản khai báo có range khác phiên bản đã khóa; tra package-lock/POM khi ghi bản chính xác.

Response User v2 là body trần, lỗi `{code,message,fieldErrors}`; các service Node dùng `{data,meta}` và `{error,meta}`. Gateway chuyển body upstream và chỉ dùng envelope cho lỗi do chính Gateway tạo. Không khẳng định toàn hệ thống có cùng envelope khi code chưa đổi.

## Kiểm tra tự động

Từ root: `node scripts/validate-docs.cjs`. Checker kiểm UTF-8, metadata, một H1 ngoài code fence, link local, JSON examples và baseline contract với source. `--format` chuẩn hóa metadata/whitespace/fence không nhãn; không tự đổi số liệu nghiệp vụ. Ngày metadata do người cập nhật xác nhận.

Báo cáo kiểm thử ghi command, số pass/fail/skip, local/CI và phạm vi mock/thật riêng. Test skip hoặc build pass không chứng minh integration đã nghiệm thu. Báo cáo feature cũ giữ nguyên số test tại thời điểm đó; trạng thái hiện tại tra [báo cáo validation](bao-cao-validation.md).
