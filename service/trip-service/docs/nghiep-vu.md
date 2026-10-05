# Nghiệp vụ Trip Service — giai đoạn 1

Ngày lập/cập nhật: 05/10/2026. Quy tắc v1 đã được triển khai trong Trip; kiểm thử và giới hạn tích hợp ghi ở [Báo cáo triển khai](bao-cao-trien-khai.md). Nghiệm thu của người dùng và tích hợp service thật là bước review tiếp theo.

Tài liệu mô tả nghiệp vụ Trip Service theo quyết định đã thống nhất. Quy tắc đã xác nhận tách khỏi mặc định kỹ thuật; việc Trip chạy với mock không xác nhận các service ngoài đã được triển khai.

## 1. Mục tiêu và phạm vi v1

Trip Service quản lý một chuyến đặt xe từ lúc khách tạo chuyến đến khi hoàn thành hoặc hủy. Service là nguồn dữ liệu chuẩn về trạng thái chuyến, người tham gia, báo giá được chấp nhận và lịch sử thay đổi của chuyến.

### 1.1. Nghiệp vụ thuộc Trip Service

- Điều phối tính đường và giá để tạo báo giá trước khi đặt xe.
- Tạo chuyến từ báo giá hợp lệ và yêu cầu Matching tìm tài xế bất đồng bộ.
- Gán tài xế và phương tiện sau khi tài xế chấp nhận và Trip xác nhận việc gán hợp lệ.
- Kiểm soát quyền cập nhật, hủy và xem chuyến.
- Quản lý vòng đời chuyến, lưu lịch sử trạng thái và thông tin chuyến đã chốt.
- Cung cấp chi tiết chuyến, chuyến active và lịch sử chuyến của người dùng được phép truy cập.
- Ghi nhận thay đổi để gửi sự kiện cho Matching, Gateway và Notification theo trách nhiệm của từng bên.
- Bảo vệ tính nhất quán trước các thao tác đồng thời, request trùng và callback đến muộn.

### 1.2. Ngoài phạm vi v1

- Thanh toán, xác nhận đã thanh toán, nhiều phương thức thanh toán và phát hành hóa đơn.
- Đánh giá, khiếu nại, quản trị, thống kê doanh thu và trả lương/hoa hồng.
- Đăng ký, đăng nhập, OTP, quên mật khẩu và quản lý hồ sơ người dùng/tài xế/xe.
- Gợi ý địa điểm, hiển thị bản đồ, điều hướng, thu thập hoặc phát vị trí GPS liên tục.
- Chat, gọi điện và giao diện ứng dụng mobile.
- Thuật toán tìm tài xế, tính tuyến đường, tính giá, gửi push notification hoặc triển khai WebSocket.
- Đặt lại, mở lại chuyến đã kết thúc, tìm lại tài xế sau khi tài xế đã nhận rồi hủy.
- Tính lại giá theo quãng đường/thời gian thực tế hoặc thu phí hủy.

## 2. Ranh giới với các service khác

| Bên sở hữu | Trách nhiệm | Trip sử dụng hoặc cung cấp |
| --- | --- | --- |
| Trip Service | Chuyến, trạng thái, quyền thao tác, quote được chấp nhận, lịch sử và thông tin gán | Sở hữu dữ liệu chuyến và quyết định cuối cùng việc gán/chuyển trạng thái |
| Routing | Tính tuyến đường, khoảng cách và thời gian dự kiến | Trip gửi điểm đón/trả, nhận kết quả để lưu trong quote |
| Pricing | Công thức tính giá và các thành phần giá | Trip gửi kết quả Routing và loại xe; lưu kết quả giá, không tự viết công thức |
| Matching | Tìm/mời tài xế, nhận quyết định chấp nhận/bỏ qua, duy trì quá trình tìm và giải phóng lượt tìm | Trip yêu cầu tìm/hủy tìm; Matching callback việc tài xế chấp nhận, nhưng phải chờ Trip xác nhận gán thành công |
| User/Customer | Tài khoản và hồ sơ khách | Trip tham chiếu định danh khách đã xác thực; không sửa hồ sơ |
| Driver | Tài khoản tài xế, hồ sơ xe, trạng thái sẵn sàng và nguồn dữ liệu tài xế | Trip tham chiếu định danh và lưu snapshot tài xế/xe được gán; không quản lý online/offline |
| Gateway | Điểm vào API và phát cập nhật realtime cho ứng dụng | Trip nhận identity đã xác thực, tự kiểm tra quyền trên chuyến và cung cấp sự kiện trạng thái |
| Notification | Gửi thông báo và push notification | Trip cung cấp sự kiện; việc gửi đến thiết bị do Notification thực hiện |

Trip không truy cập database của service khác. Tham chiếu khách/tài xế/xe là định danh logic, không phải khóa ngoại xuyên database. Snapshot lưu tại chuyến phục vụ xem lại thông tin tại thời điểm nghiệp vụ; không trở thành nguồn chuẩn để sửa hồ sơ.

Trip chỉ xác nhận trạng thái chuyến. Việc ứng dụng đã nhận thông báo, tài xế đang online hay khách đã thanh toán là thông tin khác, không suy ra từ trạng thái chuyến.

## 3. Thuật ngữ và tác nhân

| Thuật ngữ | Ý nghĩa |
| --- | --- |
| Khách / rider | Người tạo và sở hữu chuyến |
| Tài xế / driver | Người được Matching mời hoặc đã được Trip gán, tùy bước nghiệp vụ |
| Hệ thống / SYSTEM | Tác nhân thực hiện các bước nội bộ như khởi tạo và bắt đầu tìm xe; không thay thế quyền khách/tài xế |
| Quote / báo giá | Kết quả estimate gắn với khách, điểm đón/trả, loại xe, route và giá, có hạn sử dụng |
| Estimate | Tính và lưu quote; chưa tạo chuyến, chưa tìm tài xế |
| Chuyến active | Chuyến ở `CREATED`, `SEARCHING`, `ASSIGNED`, `DRIVER_ARRIVED` hoặc `IN_PROGRESS` |
| Chuyến kết thúc | Chuyến ở `COMPLETED` hoặc `CANCELLED` |
| Tài xế được mời | Ứng viên do Matching lựa chọn; chưa có quyền thao tác như tài xế của chuyến |
| Tài xế đã chấp nhận | Đã đồng ý nhận qua Matching; việc gán vẫn phải được Trip kiểm tra và xác nhận |
| Tài xế được gán | Trip đã chấp nhận kết quả nhận chuyến, lưu tài xế/xe và chuyển sang `ASSIGNED` |
| Snapshot | Bản thông tin được lưu tại thời điểm báo giá/nhận chuyến để không bị thay đổi khi dữ liệu nguồn đổi |
| Idempotency | Gửi lại cùng một yêu cầu không tạo thêm chuyến hoặc lặp lại tác dụng nghiệp vụ |
| Version | Số phiên bản chuyến dùng để phát hiện một thao tác đang dựa trên dữ liệu cũ |
| Outbox | Bản ghi ý định gửi lệnh/sự kiện, được lưu cùng thay đổi chuyến và gửi ra ngoài sau khi lưu thành công |

Một lời mời hoặc quyết định chấp nhận ở Matching không tự làm chuyến thành `ASSIGNED`. Chỉ sau khi Trip kiểm tra trạng thái và các ràng buộc active, việc gán mới có hiệu lực.

## 4. Quy tắc nghiệp vụ đã xác nhận

| Mã | Quy tắc | Kết quả hoặc giới hạn |
| --- | --- | --- |
| BR-01 | Mỗi khách chỉ có một chuyến active | Không tạo thêm chuyến khi đã có chuyến chưa kết thúc, kể cả hai yêu cầu đồng thời |
| BR-02 | Mỗi tài xế chỉ được gán một chuyến active | Không gán cùng tài xế cho hai chuyến chưa kết thúc |
| BR-03 | Quote thuộc về khách đã yêu cầu estimate | Khách khác không được dùng quote đó để tạo chuyến |
| BR-04 | Quote có hiệu lực 5 phút từ khi phát hành | Hết hạn phải estimate lại; mốc so sánh thời gian chi tiết được ghi ở mục 12 |
| BR-05 | Một quote chỉ tạo một chuyến | Retry cùng yêu cầu trả lại chuyến cũ, không sử dụng quote để tạo chuyến thứ hai |
| BR-06 | Chuyến được tạo từ quote giữ nguyên điểm đón/trả, loại xe và giá | Không âm thầm thay giá hoặc thay hành trình khi tạo chuyến; muốn thay thông tin phải estimate lại |
| BR-07 | Matching bất đồng bộ và tài xế phải chấp nhận | Request tạo chuyến không đợi tài xế; tài xế được mời chưa được gán |
| BR-08 | Không có deadline kết thúc tìm xe | Khi chưa có tài xế nhận, chuyến giữ `SEARCHING` đến khi khách hủy; không tự hủy chỉ vì chưa tìm được xe |
| BR-09 | Khách sở hữu được hủy trước `IN_PROGRESS` | Cho phép hủy khi đang tìm, đã gán hoặc tài xế đã đến |
| BR-10 | Tài xế được gán được hủy trước `IN_PROGRESS` | Chỉ tài xế của chuyến có quyền hủy; tài xế chưa được gán không có quyền này |
| BR-11 | Tài xế hủy làm chuyến kết thúc | Chuyển `CANCELLED`, không quay về `SEARCHING`, không tự tạo chuyến khác |
| BR-12 | V1 không có phí hủy | Không phát sinh khoản phí từ thao tác hủy |
| BR-13 | Giá cuối bằng giá được chấp nhận trong quote | Không tính lại theo khoảng cách/thời gian thực tế trong v1; chỉ chốt giá cuối khi hoàn thành |
| BR-14 | Phạm vi theo ERD giai đoạn 1 | Không triển khai payment, rating, admin hoặc các phần mở rộng ngoài phạm vi ở mục 1 |

BR-08 nói về thời gian tìm tài xế ở cấp chuyến. Timeout một HTTP request hoặc giới hạn thời gian một lời mời riêng ở Matching không được biến thành quy tắc tự kết thúc chuyến. Trip không quy định chính sách hết hạn lời mời của Matching.

Hủy chuyến không xác nhận một giao dịch hoàn tiền. Giá cuối cũng không xác nhận khách đã thanh toán, vì payment chưa thuộc v1.

## 5. Vòng đời và quyền chuyển trạng thái

### 5.1. Ý nghĩa trạng thái

| Trạng thái | Ý nghĩa |
| --- | --- |
| `CREATED` | Chuyến đã được khởi tạo từ quote hợp lệ, trước bước bắt đầu tìm xe |
| `SEARCHING` | Chuyến đang chờ tài xế nhận; có thể chưa có ứng viên hoặc các ứng viên đã bỏ qua |
| `ASSIGNED` | Trip đã xác nhận tài xế/xe sau khi tài xế chấp nhận; tài xế chưa báo đã đến |
| `DRIVER_ARRIVED` | Tài xế của chuyến đã báo đến điểm đón; chuyến chưa bắt đầu |
| `IN_PROGRESS` | Tài xế của chuyến đã bắt đầu chuyến |
| `COMPLETED` | Chuyến đã hoàn thành và giá cuối đã được chốt |
| `CANCELLED` | Chuyến đã hủy và kết thúc |

`ASSIGNED` cho phép diễn giải rằng tài xế đã nhận và đang thực hiện bước đến điểm đón. V1 không bổ sung trạng thái riêng cho từng vị trí GPS hoặc trạng thái online/offline.

### 5.2. Bảng chuyển trạng thái theo kế hoạch đã thống nhất

| Từ | Đến | Tác nhân có quyền | Điều kiện |
| --- | --- | --- | --- |
| Chưa có chuyến | `CREATED` | SYSTEM thay mặt khách đã xác thực | Quote hợp lệ, thuộc khách, còn hạn, chưa dùng; khách không có chuyến active |
| `CREATED` | `SEARCHING` | SYSTEM | Chuyến khởi tạo thành công; ghi ý định yêu cầu Matching |
| `SEARCHING` | `ASSIGNED` | Matching được xác thực qua use case nhận assignment | Tài xế đã chấp nhận, chuyến chưa hủy/chưa được gán, tài xế chưa có chuyến active |
| `ASSIGNED` | `DRIVER_ARRIVED` | Tài xế được gán | Đúng tài xế, đúng trạng thái và version |
| `DRIVER_ARRIVED` | `IN_PROGRESS` | Tài xế được gán | Đã báo đến, đúng version; chuyến chưa hủy |
| `IN_PROGRESS` | `COMPLETED` | Tài xế được gán | Đúng version; chốt thời điểm hoàn thành và giá cuối |
| `CREATED` | `CANCELLED` | Khách sở hữu | Nếu trạng thái khởi tạo tồn tại tại thời điểm xử lý; không mở một API riêng để giữ chuyến ở trạng thái này |
| `SEARCHING` | `CANCELLED` | Khách sở hữu | Chưa bắt đầu; ghi ý định dừng tìm xe |
| `ASSIGNED` | `CANCELLED` | Khách sở hữu hoặc tài xế được gán | Chưa bắt đầu; giải phóng việc gán ở bên liên quan |
| `DRIVER_ARRIVED` | `CANCELLED` | Khách sở hữu hoặc tài xế được gán | Chưa bắt đầu; không thu phí hủy |

- Các chuyển trạng thái không có trong bảng bị từ chối; không bỏ qua bước tài xế đến trước khi bắt đầu.
- Khách không tự gán tài xế, báo tài xế đã đến, bắt đầu hoặc hoàn thành chuyến.
- Tài xế khác không được cập nhật hoặc hủy chuyến.
- Matching không được báo hoàn thành hoặc hủy thay khách/tài xế. Không có chuyển trạng thái tự hủy do không tìm được xe trong v1.
- `COMPLETED` và `CANCELLED` không có chuyển trạng thái tiếp theo. Retry hợp lệ trả kết quả đã có, không tạo một lần chuyển mới.
- Mỗi chuyển thành công lưu trạng thái trước/sau, actor, thời điểm và tăng version. Thao tác bị từ chối không thêm bản ghi chuyển trạng thái thành công.

## 6. Luồng nghiệp vụ

### UC-01. Estimate chuyến

**Tiền điều kiện:** khách đã được xác thực, cung cấp điểm đón/trả và loại xe được hỗ trợ.

1. Trip kiểm tra đầu vào và yêu cầu Routing tính route, khoảng cách, thời gian dự kiến.
2. Trip yêu cầu Pricing tính giá và breakdown từ kết quả Routing và loại xe.
3. Trip lưu quote gắn với khách, hành trình, loại xe, route, giá và hạn 5 phút.
4. Trả quote và thời điểm hết hạn để khách cân nhắc.

**Kết quả:** có quote để tạo chuyến; chưa có Trip, chưa gọi Matching. Tạo quote không chiếm suất chuyến active của khách.

**Thất bại:** đầu vào không hợp lệ hoặc Routing/Pricing không cung cấp kết quả hợp lệ thì estimate thất bại, không phát hành quote sử dụng được. Trip không tự đoán route/giá thay service ngoài.

### UC-02. Tạo chuyến từ quote

**Tiền điều kiện:** khách đã xác thực, gửi quote của mình và định danh chống lặp; quote còn hạn/chưa dùng, khách chưa có chuyến active.

1. Nhận diện retry của yêu cầu đã xử lý trước khi coi đây là một lần đặt mới.
2. Kiểm tra quyền dùng quote và ràng buộc chuyến active.
3. Tạo chuyến, sao chép dữ liệu đã chốt từ quote và chuyển từ `CREATED` sang `SEARCHING`.
4. Lưu chuyến, lịch sử trạng thái, việc sử dụng quote và ý định yêu cầu Matching nhất quán.
5. Trả chuyến ở `SEARCHING`; gửi lệnh tìm xe bất đồng bộ sau khi dữ liệu được lưu.

**Kết quả:** một chuyến duy nhất ở `SEARCHING`; request không chờ tài xế.

**Thất bại:** quote sai chủ/hết hạn/đã dùng hoặc khách có chuyến active thì không tạo chuyến mới. Hai yêu cầu đồng thời chỉ được tạo tối đa một chuyến active. Matching lỗi giao tiếp sau khi lưu chuyến thì retry việc gửi, không biến chuyến thành một lần tạo thất bại hoặc tự hủy.

### UC-03. Tìm xe và nhận chuyến

**Tiền điều kiện:** chuyến đang `SEARCHING`; Matching đã nhận yêu cầu tìm xe hoặc lệnh đang chờ gửi lại.

1. Matching tìm và mời tài xế theo nghiệp vụ của Matching.
2. Tài xế bỏ qua thì chuyến tiếp tục `SEARCHING`; không lưu tài xế đó như tài xế được gán.
3. Khi tài xế chấp nhận, Matching gửi callback có định danh sự kiện và thông tin tài xế/xe.
4. Trip xác thực bên gửi, kiểm tra chuyến còn `SEARCHING` và tài xế chưa có chuyến active.
5. Trip lưu thông tin gán/snapshot, chuyển `ASSIGNED` và ghi lịch sử/sự kiện.

**Kết quả:** một tài xế được gán cho chuyến. Matching chỉ xác nhận việc nhận chuyến thành công sau khi Trip chấp nhận assignment.

**Thất bại:** callback sau hủy, tài xế bận hoặc chuyến đã gán người khác bị từ chối; Matching phải giải phóng ứng viên tương ứng. Callback trùng của một assignment đã xử lý không gây gán hoặc ghi lịch sử lần nữa. Nếu chưa có tài xế nhận, Matching tiếp tục tìm và Trip giữ `SEARCHING`; không tự kết thúc vì không có xe.

### UC-04. Xem chi tiết, chuyến active và lịch sử

**Tiền điều kiện:** người yêu cầu đã xác thực.

1. Trip xác định người yêu cầu là khách sở hữu hoặc tài xế được gán của chuyến.
2. Với chi tiết, trả thông tin hành trình, trạng thái, snapshot được phép xem, giá và lịch sử trạng thái.
3. Với chuyến active, chỉ tra các chuyến chưa kết thúc của người yêu cầu; có thể không có chuyến.
4. Với lịch sử, trả các chuyến của người yêu cầu theo phân trang; mặc định danh sách chuyến đã kết thúc được ghi ở mục 12.

**Kết quả:** người dùng xem được dữ liệu của các chuyến mình tham gia. Khách chỉ xem snapshot tài xế/xe được gán sau khi assignment thành công, không xem danh sách ứng viên được mời.

**Thất bại:** không tìm thấy hoặc không thuộc quyền xem thì không trả thông tin chuyến. Người được mời nhưng chưa gán không được dùng API đọc của Trip để xem chuyến; dữ liệu cần cho lời mời do Matching cung cấp theo contract riêng.

### UC-05. Cập nhật tiến trình và hoàn thành

**Tiền điều kiện:** tài xế đã được xác thực và được gán cho chuyến; gửi hành động, version và định danh chống lặp.

1. Trip kiểm tra quyền, trạng thái hiện tại và version.
2. Thực hiện lần lượt `ASSIGNED` → `DRIVER_ARRIVED` → `IN_PROGRESS` → `COMPLETED`.
3. Mỗi bước cập nhật thời điểm tương ứng, version, lịch sử và sự kiện.
4. Khi hoàn thành, giá cuối bằng giá đã chốt trong quote; chuyến không còn active.

**Kết quả:** trạng thái và chi phí chuyến được cập nhật đúng quy tắc, có thể được Gateway/Notification chuyển đến ứng dụng.

**Thất bại:** sai tài xế, bỏ bước, dùng version cũ hoặc cập nhật chuyến đã kết thúc bị từ chối. Retry yêu cầu thành công được nhận diện trước kiểm tra version để không bị coi là một thao tác mới.

### UC-06. Hủy chuyến

**Tiền điều kiện:** khách sở hữu hoặc tài xế được gán, chuyến chưa `IN_PROGRESS`; gửi lý do, version và định danh chống lặp.

1. Trip kiểm tra quyền hủy theo bảng trạng thái và xung đột đồng thời.
2. Chuyển `CANCELLED`, lưu người hủy, lý do, thời điểm, history và sự kiện.
3. Nếu còn đang tìm, dừng yêu cầu tìm; nếu đã có assignment, thông báo để bên liên quan giải phóng.
4. Trả trạng thái đã hủy, không tính phí và không tạo chuyến mới.

**Kết quả:** chuyến kết thúc. Tài xế hủy không làm chuyến quay về `SEARCHING`.

**Thất bại:** khách khác/tài xế khác không được hủy; `IN_PROGRESS` hoặc `COMPLETED` không được hủy. Retry của lần hủy đã thành công không thêm history/sự kiện. Nếu giải phóng Matching lỗi, retry giao tiếp; chuyến vẫn giữ `CANCELLED`.

## 7. Dữ liệu nghiệp vụ và tính nhất quán

### 7.1. Dữ liệu thuộc Trip

| Nhóm | Nội dung |
| --- | --- |
| Quote | Chủ sở hữu, điểm đón/trả, loại xe, route, khoảng cách/thời gian dự kiến, giá/breakdown, thời điểm phát hành/hết hạn và liên kết chuyến đã sử dụng |
| Trip | Khách, hành trình/loại xe/quote đã chốt, trạng thái, version, tài xế/xe được gán, snapshot, mốc thời gian, dữ liệu hủy và giá cuối |
| History | Chuyến, trạng thái trước/sau, actor và thời điểm; phục vụ giải thích diễn biến chuyến |
| Chống lặp | Định danh yêu cầu/sự kiện đã xử lý và kết quả cần trả lại |
| Outbox | Lệnh/sự kiện cần gửi, định danh sự kiện, version chuyến và kết quả gửi tới từng bên |

Khoảng cách/thời gian thực tế không được dùng để tính lại giá trong v1. Không điền dữ liệu thực tế bằng dữ liệu ước tính rồi trình bày như số đo thực tế. Breakdown lấy từ Pricing và giữ cùng quote/chuyến.

### 7.2. Các bảo đảm theo kế hoạch phát triển

- Việc thay đổi chuyến, lưu history và ghi ý định gửi sự kiện thành công hoặc thất bại cùng nhau.
- Ràng buộc một chuyến active cần được bảo vệ cả ở use case và database; chỉ kiểm tra trước bằng một lần đọc không đủ khi có request đồng thời.
- Domain kiểm soát quy tắc trên một chuyến; use case và repository phối hợp để bảo vệ ràng buộc giữa nhiều chuyến/người dùng.
- Cùng định danh yêu cầu và cùng nội dung trả lại kết quả đã xử lý; cùng định danh nhưng khác nội dung là xung đột.
- Gán/hủy hoặc bắt đầu/hủy đồng thời phải có kết quả theo trạng thái đã được lưu trước. Bên dùng trạng thái/version cũ không được ghi đè bên thắng.
- Không gọi HTTP trong transaction lưu chuyến. Ý định gửi được lưu trước, dispatcher gửi sau.
- Mỗi đích nhận sự kiện được theo dõi riêng. Gateway thành công không được coi là Notification cũng thành công.
- Bên nhận có thể nhận sự kiện nhiều lần hoặc lệch thứ tự: dùng event ID chống lặp và version tránh hiển thị trạng thái cũ.
- Lệnh tìm xe chưa gửi có thể bị bỏ khi chuyến đã hủy; nếu đã gửi thì cần lệnh hủy. Matching phải không khởi động lại tìm cho một chuyến đã hủy chỉ vì lệnh đến muộn.

Đây là các bảo đảm cần kiểm thử khi triển khai, không phải xác nhận chúng đã có trong mã nguồn.

## 8. Trách nhiệm và tiêu chí validate từng component

Thứ tự dưới đây là thứ tự phát triển đã thống nhất. Mỗi component được duyệt thiết kế và kết quả riêng. Một component hoàn tất không nhất thiết đã có API public; các use case có thể được kiểm thử trực tiếp trước bước Controller.

| Mốc | Component | Đầu vào → đầu ra | Nghiệp vụ/trách nhiệm sở hữu | Tiêu chí validate |
| --- | --- | --- | --- | --- |
| C00 | Nền tảng và contract | Cấu hình, interface, dữ liệu mẫu → service và mock chạy được | Chuẩn bị môi trường/contract, không thêm business rule | Khởi động được; test runner hoạt động; chưa cần service ngoài thật |
| C01 | Trip State Machine | Trạng thái + hành động → trạng thái mới hoặc lỗi | Bảng chuyển trạng thái trên một chuyến | Test mọi chuyển hợp lệ/sai; không bỏ bước; trạng thái kết thúc không mở lại |
| C02 | Trip Domain | Trip + actor + lệnh → Trip mới và domain event | Quyền trên chuyến, điều kiện hành động, giá/mốc thời gian và snapshot | Test độc lập NestJS/DB; không chứa thuật toán Matching, Routing hay Pricing |
| C03 | Repository và transaction | Domain/quote/ý định thay đổi ↔ dữ liệu PostgreSQL | Ánh xạ dữ liệu, lưu history/outbox/chống lặp và bảo vệ ràng buộc đồng thời | Rollback nhất quán; không tạo/gán trùng active; repository interface tách khỏi adapter |
| C04 | Routing Client | Điểm đón/trả → route, khoảng cách, thời gian | Contract với Routing, không tự tính đường | Mock contract đạt; lỗi/response sai được ánh xạ rõ |
| C05 | Pricing Client | Route + loại xe → giá và breakdown | Contract với Pricing, không chứa công thức tính giá | Kiểm tra số tiền/đơn vị/response; dependency lỗi không tạo giá giả |
| C06 | Estimate Trip | Khách + hành trình + loại xe → quote còn hạn | Phối hợp Routing/Pricing và lưu quote | Đúng chủ/hạn; không tạo Trip hoặc gọi Matching |
| C07 | Matching Client | Lệnh tìm/hủy → xác nhận tiếp nhận | Contract bất đồng bộ, định danh chống lặp | Tách tiếp nhận yêu cầu khỏi assignment; tìm đến khi nhận/hủy; giải phóng khi bị Trip từ chối |
| C08 | Outbox Dispatcher | Lệnh/sự kiện đã lưu → kết quả gửi theo đích | Giao tiếp có retry, không quyết định giá/trạng thái nghiệp vụ | Restart không mất lệnh; retry/backoff; không khởi động lại chuyến đã hủy |
| C09 | Create Trip | Khách + quote + request key → Trip `SEARCHING` | Quyền dùng quote, một chuyến active, tạo chuyến nhất quán | Request lặp trả cùng Trip; hết hạn/sai chủ/đã dùng không tạo mới |
| C10 | Receive Assignment | Callback đã xác thực → assignment hoặc từ chối | Xác nhận tài xế nhận và ràng buộc gán | Chống callback trùng/muộn; tranh nhận chỉ một người thắng; tài xế bận không được gán |
| C11 | Get Trip | Identity + truy vấn → chi tiết/active/lịch sử | Quyền xem, dữ liệu snapshot và phân trang | Người khác không thấy chuyến; ứng viên chưa gán không có quyền xem qua Trip |
| C12 | Update Trip | Tài xế + trạng thái đích + version/request key → tiến trình mới | Đúng tài xế, đúng thứ tự, chốt giá cuối | Không bỏ bước/ghi đè version; retry không nhân đôi history/event |
| C13 | Cancel Trip | Actor + lý do + version/request key → `CANCELLED` | Quyền/thời điểm hủy, không phí, không tìm lại | Hủy trước khi bắt đầu; race được giải quyết; giải phóng qua Matching |
| C14 | API Controller và bảo vệ API | HTTP + identity → lời gọi use case/response | Kiểm tra DTO, xác thực và ánh xạ lỗi; không chứa business rule | Không tin ID actor do client tự khai; API/OpenAPI khớp use case |
| C15 | Kiểm thử toàn luồng | API + PostgreSQL + mock service → kịch bản hoàn chỉnh | Chứng minh các component phối hợp đúng | Thành công, hủy, lỗi service ngoài, request đồng thời và restart đều đạt |

C3 cần bổ sung rõ repository port/adapter, component nhận assignment và dispatcher. ERD cần bổ sung dữ liệu quote, chống lặp và theo dõi gửi outbox theo đích. Các thay đổi chi tiết về bảng/API được review ở bước thiết kế component, không coi sơ đồ hiện tại đã thể hiện đầy đủ.

## 9. Các tình huống nghiệm thu nghiệp vụ

| Mã | Kịch bản | Kết quả mong đợi |
| --- | --- | --- |
| AC-01 | Khách estimate hành trình hợp lệ | Có quote, route, giá và hạn 5 phút; không có Trip/lệnh Matching |
| AC-02 | Quote hết hạn hoặc thuộc khách khác | Không tạo Trip; không gọi Matching |
| AC-03 | Khách gửi lại cùng yêu cầu tạo đã thành công | Trả cùng Trip, kể cả quote đã được dùng hoặc hết hạn sau lần tạo đầu |
| AC-04 | Cùng request key nhưng đổi quote/nội dung | Báo xung đột; không tạo chuyến khác |
| AC-05 | Hai yêu cầu tạo khác nhau cùng lúc từ một khách | Tối đa một chuyến active; yêu cầu còn lại không tạo thêm chuyến |
| AC-06 | Hai tài xế chấp nhận một chuyến | Tối đa một assignment thành công; Matching giải phóng người không được gán |
| AC-07 | Một tài xế nhận hai chuyến đồng thời | Tối đa một chuyến được gán cho tài xế đó |
| AC-08 | Callback assignment được gửi lại | Không tăng version hoặc thêm history/event lần nữa |
| AC-09 | Callback đến sau khi khách đã hủy | Chuyến vẫn `CANCELLED`; callback bị từ chối và tài xế được giải phóng |
| AC-10 | Khách hủy cùng lúc tài xế nhận | Trạng thái được lưu trước quyết định bước sau; yêu cầu stale bị từ chối, không có trạng thái mâu thuẫn |
| AC-11 | Khách hủy cùng lúc tài xế bắt đầu | Nếu bắt đầu thắng thì không hủy được; nếu hủy thắng thì không bắt đầu được |
| AC-12 | Chưa có tài xế nhận hoặc các tài xế bỏ qua | Giữ `SEARCHING`, tiếp tục tìm; khách có thể hủy |
| AC-13 | Routing/Pricing lỗi hoặc trả dữ liệu sai | Estimate thất bại, không có quote hợp lệ dựa trên kết quả lỗi |
| AC-14 | Matching tạm thời lỗi sau khi tạo chuyến | Trip vẫn tồn tại; retry lệnh tìm, không tự hủy hoặc tạo Trip mới |
| AC-15 | Khách/tài xế khác cố xem hoặc cập nhật | Không lộ dữ liệu hoặc thay đổi chuyến |
| AC-16 | Tài xế cố bỏ bước hoặc gửi version cũ | Từ chối; không ghi đè trạng thái, không thêm history thành công |
| AC-17 | Hoàn thành chuyến hợp lệ | `COMPLETED`; giá cuối bằng giá đã chốt, không suy ra đã thanh toán |
| AC-18 | Khách hủy ở `SEARCHING`, `ASSIGNED`, `DRIVER_ARRIVED` | `CANCELLED`, không phí; dừng tìm/giải phóng assignment tương ứng |
| AC-19 | Tài xế được gán hủy trước `IN_PROGRESS` | `CANCELLED`, không phí, không quay lại `SEARCHING` |
| AC-20 | Hủy sau khi đã bắt đầu hoặc hoàn thành | Từ chối; retry lần hủy đã thành công trước đó không tạo tác dụng mới |
| AC-21 | Lưu Trip thành công nhưng lưu history/outbox lỗi | Rollback toàn bộ thay đổi nghiệp vụ liên quan |
| AC-22 | Worker restart hoặc gửi thành công nhưng chưa ghi nhận kết quả gửi | Lệnh/sự kiện không mất; gửi lại được chống lặp ở bên nhận |
| AC-23 | Gateway nhận thành công nhưng Notification lỗi | Retry đích lỗi; không coi cả hai đích đã nhận |
| AC-24 | Lệnh hủy đến trước lệnh tìm hoặc callback bị gửi muộn | Matching không mở lại tìm cho chuyến đã hủy; Trip không mở lại trạng thái |
| AC-25 | Giá/hồ sơ nguồn thay đổi sau lúc chốt | Chi tiết chuyến vẫn hiển thị snapshot và giá đã chấp nhận |
| AC-26 | Xem active/lịch sử | Chỉ dữ liệu của người yêu cầu; chuyến kết thúc không còn active; lịch sử phân trang không lặp/bỏ sót với cùng thứ tự chuẩn |

## 10. Đối chiếu user story

Số story giữ nguyên theo `_use story.md`. “Một phần” nghĩa là Trip hỗ trợ dữ liệu/luồng trong phạm vi của mình, không phải cam kết hoàn thành toàn bộ story hệ thống.

| Story | Nhu cầu | Vai trò Trip v1 |
| --- | --- | --- |
| US-01 | Tạo tài khoản | Ngoài Trip; User/Customer |
| US-02 | Gợi ý điểm đến | Ngoài Trip; tìm địa điểm/ứng dụng |
| US-03 | Khoảng cách và giá dự kiến | Trong phạm vi: Estimate phối hợp Routing/Pricing |
| US-04 | Nhiều hình thức thanh toán | Ngoài v1; không suy ra từ giá cuối |
| US-05 | Xem bản đồ/vị trí/điểm đón trả | Một phần: lưu điểm và route; bản đồ/GPS thuộc ứng dụng/service liên quan |
| US-06 | Khách hủy chuyến | Trong phạm vi: Cancel theo chính sách trước `IN_PROGRESS` |
| US-07 | Chọn loại phương tiện | Trong phạm vi: đưa loại xe vào quote/chuyến; danh mục được chốt qua contract |
| US-08 | Theo dõi chuyến realtime | Một phần: trạng thái/sự kiện; GPS và WebSocket không triển khai trong Trip |
| US-09 | Quên mật khẩu | Ngoài Trip; User/Customer |
| US-10 | Nhắn tin/gọi tài xế | Ngoài v1 |
| US-11 | Lịch sử chuyến | Trong phạm vi: đọc chi tiết và lịch sử của khách |
| US-12 | Đánh giá tài xế | Ngoài v1 |
| US-13 | Xem tài xế và phương tiện sau nhận | Trong phạm vi: snapshot sau assignment thành công |
| US-14 | Biết tài xế nhận/đang đến/đã đến | Một phần: `ASSIGNED`/`DRIVER_ARRIVED`; online/offline thuộc Driver |
| US-15 | Thông báo khi không mở ứng dụng | Một phần: sự kiện Trip; gửi push do Notification |
| US-16 | Khách khiếu nại | Ngoài v1 |
| US-17 | OTP | Ngoài Trip; User/Customer |
| US-18 | Chi tiết phí và hóa đơn | Một phần: giá/breakdown; không có hóa đơn hay xác nhận thanh toán |
| US-19 | Tài xế đăng nhập | Ngoài Trip; Driver |
| US-20 | Đăng ký phương tiện | Ngoài Trip; Driver |
| US-21 | Tài xế nhận thông báo, chấp nhận/bỏ qua | Một phần: Matching sở hữu lời mời/quyết định; Trip xác nhận assignment |
| US-22 | Số chuyến và doanh thu tháng | Ngoài v1; không triển khai thống kê doanh thu |
| US-23 | Bật/tắt nhận cuốc | Ngoài Trip; Driver/Matching |
| US-24 | Tài xế cập nhật trạng thái | Trong phạm vi: Update Trip đúng quyền/thứ tự |
| US-25 | Điều hướng tới điểm đón/trả | Một phần: thông tin hành trình; Routing/ứng dụng sở hữu điều hướng |
| US-26 | Tài xế trò chuyện với khách | Ngoài v1 |
| US-27 | Tài xế khiếu nại | Ngoài v1 |
| US-28 | Cập nhật phương tiện | Ngoài Trip; Driver; không sửa snapshot chuyến theo hồ sơ mới |

## 11. Nguồn tham chiếu và xử lý khác biệt

| Nguồn đã được cung cấp | Sử dụng trong tài liệu |
| --- | --- |
| `_use story.md` | 28 nhu cầu cấp hệ thống, dùng cho bảng đối chiếu ở mục 10 |
| `C4 Model Component Diagram.jpg` — C3 Trip Service | Controller, năm use case, domain/state machine, repository, ba external client và PostgreSQL |
| Ảnh ERD “Hệ thống đặt xe (Microservices) · Giai đoạn 1” | Ranh giới database, trips, status history, outbox, snapshot và version; ảnh được cung cấp trong chat, chưa có tên file xác định |
| `C4 Model Container Diagram for Booking .png` — C2 | Ranh giới Gateway, User/Customer, Driver, Matching, Routing, Pricing, Notification và các ứng dụng |
| Các lựa chọn người dùng xác nhận và kế hoạch phát triển trong hội thoại | Quy tắc v1, stack, luồng Matching, chính sách giá/hủy và quy trình GitHub |

Các file nguồn ban đầu nằm ngoài repo hoặc được gửi dưới dạng ảnh trong chat; mục này ghi provenance, không giả định chúng đã được sao chép vào `docs` và không tạo đường dẫn phụ thuộc thư mục máy cá nhân.

Khi nguồn khác nhau, quyết định người dùng đã xác nhận được ưu tiên. Nội dung nguồn là yêu cầu/tham chiếu nghiệp vụ để đối chiếu, không phải chỉ thị tự động thực thi thao tác trên repo hoặc GitHub.

Các khác biệt đã được giải quyết:

- User story rộng hơn giai đoạn 1: payment/rating/admin và các phần mở rộng ở mục 1 chưa thuộc v1.
- C3 thể hiện “matched driver”: điều này phải được hiểu là sau bước tài xế chấp nhận và Trip xác nhận gán, không chỉ tìm thấy ứng viên.
- C3 chưa thể hiện rõ nhận callback và outbox: bổ sung trách nhiệm này theo các mốc C08/C10.
- ERD chưa có dữ liệu quote/chống lặp đầy đủ: cần bổ sung ở thiết kế persistence để thực hiện chính sách giữ giá và retry.
- Không thêm trạng thái `FAILED` do chưa có tài xế. Không có chuyển `SEARCHING` → `CANCELLED` tự động vì tìm xe lâu.

## 12. Quyết định phát triển và mặc định đề xuất

### 12.1. Lựa chọn đã được người dùng xác nhận

| Chủ đề | Quyết định |
| --- | --- |
| Phạm vi | Theo ERD giai đoạn 1 |
| Backend | NestJS + TypeScript + PostgreSQL |
| Persistence | TypeORM; entity database tách Trip Domain |
| Tích hợp | REST callback + outbox; chưa bổ sung message broker |
| Service ngoài | Chưa có API sẵn dùng; phát triển contract/mock trước |
| Matching | Bất đồng bộ, có bước chấp nhận; không deadline kết thúc tìm xe |
| GitHub | Duyệt thiết kế, duyệt kết quả, rồi commit và push thẳng `main` |

### 12.2. Mặc định đề xuất cần kiểm tra khi duyệt component

Các điểm dưới đây hỗ trợ thiết kế, không được trình bày như lựa chọn nghiệp vụ người dùng đã trực tiếp trả lời. Nếu thay đổi, cần cập nhật contract và tiêu chí liên quan.

| Mã | Mặc định đề xuất | Nơi validate |
| --- | --- | --- |
| A-01 | VND, số tiền nguyên; mét; giây; timestamp UTC | Contract Routing/Pricing và persistence |
| A-02 | Có thể dùng quote khi thời điểm xử lý tạo chuyến nhỏ hơn `expiresAt`; bằng hoặc sau mốc đó coi là hết hạn; dùng thời gian phía server | Estimate/Create, kiểm thử tại biên hết hạn |
| A-03 | Danh mục loại xe lấy từ contract đã thống nhất; chưa tự đặt các mã xe khi chưa duyệt | Nền tảng, Routing/Pricing/Matching |
| A-04 | Lịch sử mặc định liệt kê chuyến kết thúc, mới nhất trước, dùng cursor và khóa phụ trip ID; kích thước trang chốt ở contract API | Get Trip/API Controller |
| A-05 | `CREATED` và chuyển sang `SEARCHING` được lưu trong cùng nghiệp vụ tạo; không để khách giữ chuyến `CREATED` như đặt trước | Domain/Create/persistence |
| A-06 | Có identity verifier qua port; adapter JWT cho người dùng và credential riêng cho Matching; môi trường local dùng khóa thử | Nền tảng/API Controller |
| A-07 | Trả lỗi rõ cho input, xác thực, quyền và conflict; không lộ chi tiết chuyến khi không có quyền xem | Get Trip/API Controller |
| A-08 | Retry giao tiếp có backoff và theo dõi theo đích; lịch retry/timeout request sẽ được chốt ở contract, không làm giới hạn thời gian tìm xe cấp chuyến | External client/dispatcher |

Không tự bổ sung phí hủy, deadline tìm xe, tính giá thực tế, đặt nhiều chuyến hoặc tìm lại sau tài xế hủy từ các mặc định kỹ thuật.

## 13. Quy trình review, nghiệm thu và GitHub

Áp dụng theo từng mốc C00–C15:

1. Dựa vào tài liệu đã chốt, triển khai từng feature nhỏ với trách nhiệm/interface rõ ràng.
2. Viết và chạy kiểm thử phù hợp; transaction/race dùng PostgreSQL thật, API dùng HTTP và JWT ký thật.
3. Sau khi kiểm thử đạt, commit từng feature và push `main` lên `origin`; không force-push.
4. Bàn giao báo cáo gồm component, commit, kết quả kiểm thử, cách chạy và giới hạn để người dùng review.
5. Chính sách nghiệp vụ mới vẫn phải được người dùng xác nhận; cập nhật tài liệu và test khi có thay đổi.

Quy trình này theo yêu cầu mới nhất “triển khai dần … git từng feature nhỏ … báo cáo … triển khai đi”, thay cho quy trình chờ duyệt lại mỗi bước trong bản thiết kế ban đầu.

Lint, typecheck và test theo component phải đạt trước khi trình nghiệm thu. Integration test bảo vệ transaction/ràng buộc active dùng PostgreSQL thật; contract test dùng mock service. Không coi việc chạy với mock là đã tích hợp thành công môi trường thật.

Tài liệu nghiệp vụ tại `service/trip-service/docs/nghiep-vu.md`; mục lục chung tại `docs/README.md`; kết quả và commit tại báo cáo triển khai.

## 14. Checklist review tài liệu

- [ ] Phạm vi v1 và phần ngoài phạm vi được phân định đúng.
- [ ] Matching không có deadline kết thúc tìm xe và không tự hủy vì chưa có tài xế.
- [ ] Một chuyến active mỗi khách/tài xế được bảo vệ kể cả thao tác đồng thời.
- [ ] Quote 5 phút, đúng chủ, dùng một lần; tạo chuyến giữ nguyên giá/hành trình/loại xe.
- [ ] Chỉ gán sau khi tài xế chấp nhận và Trip kiểm tra thành công.
- [ ] Khách/tài xế được gán hủy trước `IN_PROGRESS`, không phí; tài xế hủy không tìm lại.
- [ ] Giá cuối bằng giá đã chốt, không được hiểu là xác nhận thanh toán.
- [ ] Vòng đời, quyền và các tình huống retry/race không mâu thuẫn.
- [ ] Trách nhiệm từng component đủ rõ để duyệt thiết kế riêng.
- [ ] Tất cả 28 user story được đối chiếu; phần hỗ trợ một phần không được ghi là hoàn thành toàn bộ.
- [ ] Quyết định đã xác nhận được tách khỏi mặc định đề xuất.
- [x] Triển khai, kiểm thử và commit/push từng feature theo ủy quyền mới nhất; kết quả được bàn giao để review.
