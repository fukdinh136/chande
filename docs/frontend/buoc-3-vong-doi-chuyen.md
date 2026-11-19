# Bước 3/5 — Vòng đời chuyến Customer

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Customer App / Driver App |
| Rà soát | 2026-11-18 |
| Quy ước | [Format và số liệu](../quy-uoc-tai-lieu.md) |

## Phạm vi và hiện trạng đã khảo sát

Báo cáo này giữ kết quả lịch sử bước 3. Phần lịch sử/chi tiết/đặt lại và tài khoản đã tiếp tục ở [bước 4](buoc-4-lich-su-tai-khoan.md); các giới hạn dưới đây được đọc theo mốc bước 3.

Đã triển khai phần mã nguồn bước 3 trên nền [bước 1](tien-do-customer-velox.md) và [bước 2](buoc-2-customer-dat-xe.md). Phạm vi: xác nhận đặt, phân biệt kết quả chưa rõ, khôi phục journal/chuyến, đồng bộ, mất kết nối, hủy có xác nhận và tổng kết. Không thay backend/endpoint, dependency, giá chuỗi, phiên web hoặc storage scope. Chưa triển khai bước 4–5.

Nguồn đối chiếu: [phạm vi UI](pham-vi-ui.md), [API frontend](api.md), [API Trip](../../service/trip-service/docs/api.md), [state machine](../../service/trip-service/src/domain/state-machine.ts), [schema](../../service/trip-service/src/api/schemas.ts), [receipt idempotency](../../service/trip-service/src/application/use-cases/shared.ts), WebSocket Gateway, [Velox tokens](../../stitch_ride_hailing_customer_app_ui/velox_ride/DESIGN.md), HTML/PNG [tracking](../../stitch_ride_hailing_customer_app_ui/driver_assigned_tracking/code.html) và source thực tế. Đọc AGENTS, Expo SDK 57/Router và React Native AppState trước khi sửa.

Trước bước này, store đã khóa gửi lặp, giữ pending command và quote theo giờ server. Tuy nhiên active null có thể xóa chuyến đã biết mà chưa đọc detail; chưa có tổng kết bền trong phiên, xác nhận hủy hoặc UI phân biệt rejection/uncertain; invalidation khi GET đang chạy có thể bị bỏ. WebSocket đã kích hoạt REST và có polling foreground, nhưng chưa expose trạng thái kết nối cho Customer hoặc quản lý handshake/heartbeat đầy đủ.

## Hợp đồng được giữ

| Phần | Căn cứ / hành vi |
| --- | --- |
| Trạng thái | CREATED → SEARCHING → ASSIGNED → DRIVER_ARRIVED → IN_PROGRESS → COMPLETED; CANCELLED kết thúc từ trước IN_PROGRESS. SEARCHING không có timeout tìm xe ở client |
| Create | POST `/api/v1/trips`, body chỉ `quoteId`, UUID key; thành công 201 SEARCHING. Đọc lại điều kiện/quote sau preflight REST trước khi sinh key và gửi |
| Cancel | POST `/api/v1/trips/:id/cancel`, reason/version/key; chỉ trạng thái hủy được và version >= 1 đúng schema. Đối soát trước gửi; server vẫn quyết định race với Driver start |
| Replay | Scope origin/role/actor giữ nguyên qua `commandStorage`. Retry đúng operation/key/body/version; không sửa body/version hoặc lấy key mới để né conflict. Receipt cũ không thay version mới hơn |
| Kết quả chưa rõ | Timeout/network/5xx, 408/429, request-in-progress và response không đọc được giữ journal. Lỗi 4xx dứt khoát theo cơ chế `DurableCommand` hiện có được phân biệt, rồi đọc lại REST |
| Giá/phiên | VND giữ chuỗi; quote expiry theo server, kiểm lại trước POST sau preflight. Giữ refresh token/session ownership và cơ chế web memory-only hiện có |

Không sửa [DurableCommand](../../app/src/features/backend/durable-command.ts) hoặc [command storage](../../app/src/features/backend/command-storage.ts). Native journal vẫn được ghi trước POST và theo scope đang dùng. Web giữ memory trong runtime như trước; không bổ sung localStorage/session persistence qua reload.

## Triển khai và file chính

- [Booking store](../../app/src/features/customer/booking-store.ts) giữ nguồn chuyến/journal duy nhất ở cấp phiên. Thao tác khóa ngay trong cùng lượt bấm, bao gồm giai đoạn kiểm tra REST và đối soát sau POST. Quote có thể hết hạn trong preflight: kiểm lại clock/input trước gửi, không chỉ khi hiển thị nút.
- `refresh` gom các consumer cùng chờ một lượt GET. Event dồn khi GET đang chạy chỉ xếp một lượt đọc tiếp; polling không tạo GET cạnh tranh. Trước/sau command, foreground và reset booking làm mất hiệu lực GET cũ, abort và chờ nó kết thúc trước lượt đọc mới. Kiểm generation/owner/revision ở cả active/detail/receipt.
- Active null với chuyến đã biết chưa terminal phải đọc GET detail để chứng minh kết thúc. Detail lỗi/404 hoặc còn active không bị đổi thành “không có chuyến”; giữ snapshot, cảnh báo và khóa lệnh mới. Pending cancel khôi phục có tripId cũng đọc detail khi active null. Pending create chưa có tripId vẫn khóa lượt đặt mới cho đến khi retry receipt xác định được chuyến.
- Receipt replay được decode trước khi journal được xóa; cancel receipt phải đúng tripId/CANCELLED, create quoteId nếu có phải khớp. Receipt không hạ version hoặc thay một active Trip khác đã thấy. Nếu xóa journal lỗi sau HTTP thành công, vẫn giữ snapshot đã nhận cùng pending intent để replay an toàn.
- [Trip policy](../../app/src/features/customer/trip-policy.ts) chứa nội dung trạng thái Customer, điều kiện hủy, so version và phân loại kết quả. Dữ liệu version cũ, cùng version nhưng khác status, hoặc terminal bị quay lại active không mở lại hành động dựa trên snapshot đó.
- [Active/summary card](../../app/src/features/customer/active-trip-card.tsx) hiển thị trạng thái, điểm, giá đúng nhãn, driver/vehicle snapshot hoặc fallback khi thiếu. Có bước “Hủy chuyến” → “Xác nhận hủy chuyến”; backend đổi sang IN_PROGRESS thì dừng yêu cầu hoặc xử lý conflict và đọc lại. Không có GPS Driver, ETA đến đón, call/chat/PIN/rating giả.
- [Lifecycle UI](../../app/src/features/customer/trip-lifecycle.tsx) tách processing/uncertain/rejected/confirmed, cảnh báo kết nối và thời điểm đọc thành công gần nhất. Không hiện form đặt mới khi chuyến hoặc journal chưa được xác minh. Terminal giữ tổng kết đến khi người dùng chọn “Đặt chuyến mới”; nút chỉ mở khi trạng thái và journal hợp lệ, rồi kiểm tra lại trước cho chỉnh draft.
- [Home](../../app/src/features/customer/home.tsx) dùng cùng nguồn Trip cho map/card/header, giữ điểm static thật và dừng clock timer khi background. [Provider](../../app/src/features/customer/booking-provider.tsx) có một event subscription, một connection subscription và một poll timer 5 giây trong foreground; cleanup theo owner/layout, không theo từng tab.

## WebSocket và khôi phục

[TripEvents](../../app/src/features/backend/trip-events.ts) vẫn dùng raw `/ws`, auth bằng token Customer; event chỉ invalidate REST. `auth.ok` của Customer phải đúng RIDER/userId đang đăng nhập; pre-auth event không kích hoạt đồng bộ. `start()` lặp không tạo socket thứ hai. Auth/reconnect đều kích hoạt đối soát REST; có trạng thái connecting/connected/retrying/error/paused cho UI.

Một handshake deadline 10 giây, một heartbeat 25 giây và một retry timer 5 giây cho scope hiện tại. Không nhận pong hơn 60 giây sẽ reconnect. Stop/background/logout dọn socket handlers và mọi timer; token/handler cũ không mở lại socket hoặc publish cho owner mới. Driver dùng coordinator riêng hiện có; kiểm thử hồi quy Driver được giữ.

Mất WebSocket không đồng nghĩa mất REST: UI báo gián đoạn trực tiếp và tiếp tục polling foreground. REST lỗi giữ Trip gần nhất, đặt `checked=false` và không suy diễn đã kết thúc. Snapshot chuyến chỉ sống trong phiên; mở lại native app hoặc đăng nhập lại đọc journal và active từ backend, không giả có cache chuyến offline sau restart.

Trường hợp pending create mà chuyến đã kết thúc trước khi mở app: active có thể null; retry đúng key lấy receipt ban đầu, sau đó đọc detail theo tripId để nhận COMPLETED/CANCELLED mới nhất. Không bắt người dùng tạo yêu cầu mới vì quote ban đầu hết hạn.

## Đối chiếu tiêu chí

| Tiêu chí | Trạng thái | Bằng chứng / giới hạn |
| --- | --- | --- |
| Xác nhận → theo dõi → kết thúc liền mạch | Đạt trong source/unit/UI tests | Có nội dung bảy trạng thái, cancel confirmation, tổng kết và đường dẫn detail/new booking |
| Không mất chống tạo trùng | Đạt trong tests | Double tap, timeout/replay, journal clear failure, pending restore và quote hết hạn khi xác nhận |
| Không tạo mới khi chưa xác minh | Đạt trong tests | Active/detail error, active null chưa terminal, pending journal, old GET/owner/version và fresh preflight |
| Mất mạng/khôi phục có nội dung rõ | Đạt trong tests | Giữ snapshot, cảnh báo, retry đúng intent, foreground/reconnect REST và polling fallback |
| Luồng backend thật/Android/web tương tác | Chưa nghiệm thu | Gateway local không kết nối được; adb không có thiết bị; browser host không khả dụng |

## Kiểm tra ngày 2026-11-18

Node `v24.21.0`, trong `app/` nếu không ghi khác. Mock chỉ ở test và ranh giới native/network/router/storage; không đưa fixture vào luồng thật. Không bỏ qua hay làm yếu lint/test. Regression cũ được cập nhật để kiểm tổng kết giữ lại đến khi chủ động đặt chuyến mới, thay vì coi cancel là tự xóa mọi thông tin chuyến.

| Kiểm tra | Kết quả |
| --- | --- |
| `npm.cmd run lint` | Pass, không lỗi/warning ESLint |
| `npm.cmd run typecheck` | Pass |
| `npm.cmd test` | 123 test: 118 pass, 0 fail, 5 integration skip; gồm hồi quy Driver |
| `node scripts/validate-docs.cjs` từ root | Pass: 65 tài liệu UTF-8, 524 liên kết nội bộ, 54 ví dụ JSON, 27 kiểm tra hợp đồng source |
| `git diff --check` từ root | Pass |
| Bộ test mới lifecycle/socket/UI | 25 test trong suite: double submit, unknown outcomes, reopen, null/detail, version/replay, cancellation race, account change, WebSocket reconnect/handshake/heartbeat, polling/cleanup và bảy trạng thái UI |
| `node --test test/customer-trip-lifecycle.test.cjs test/customer-trip-ui.test.cjs test/customer-prebooking.test.cjs` | 29 pass sau kiểm tra bổ sung giờ server trong preflight |
| `APP_VARIANT=customer`; `npm.cmd exec -- expo export --platform android --output-dir .expo/step3-customer-android --max-workers 2` | Pass JS/Hermes bundle |
| `APP_VARIANT=customer`; `npm.cmd exec -- expo export --platform web --output-dir .expo/step3-customer-web --max-workers 2` | Pass web bundle/static routes |
| `APP_VARIANT=driver`; `npm.cmd exec -- expo export --platform android --output-dir .expo/step3-driver-android --max-workers 2` | Pass bundle hồi quy Driver |
| Probe GET `/api/v1/trips/active` không token ở 127.0.0.1:18080/18081, timeout 2,5 giây | Cả hai không kết nối được; không chạy live API hoặc tự dựng backend |
| `adb devices -l` ngoài sandbox | Daemon chạy, không có thiết bị/emulator trong danh sách; chưa build/cài/chạy APK |
| CUA browser inventory | Không có browser, `The browser access host is unavailable`; chưa có screenshot hoặc kiểm tra tương tác web |

Năm integration skip giữ env mặc định hiện có: User/Trip public live, Driver OTP live, booking hai role, Driver production adapters và rich-route navigation. Có warning deprecation `react-test-renderer` hiện có và warning môi trường màu Metro; không tắt chúng. Export ở `.expo/` được ignore, không commit build output. Không đọc/sửa secret hoặc `.env.local`.

## Chi tiết chuyến và phần bước 4

Các card active/terminal đều nối tới [route detail hiện có](../../app/src/features/customer/trip-detail.tsx) `/customer/trips/[id]`, có guard phiên và Back/fallback từ bước 1. Trong bước 3, đọc detail trong **store** phục vụ đối soát terminal; không biến trang detail cũ thành một nguồn active/journal khác.

Trang detail hiện là GET khi mở/Retry và status history cơ bản; chưa restyle đầy đủ chi phí/breakdown/history theo thiết kế, chưa đồng bộ live riêng cho detail hoặc cải tiến toàn bộ phân trang/filter/rebook lịch sử. Các phần này dành cho bước 4 khi được giao. Không dùng kết quả bước 3 để tuyên bố detail/history đã nghiệm thu hoàn chỉnh.

## Checklist thủ công và điều kiện còn thiếu

Cần backend/Gateway thật tại public origin cấu hình sẵn, hai account Customer/Driver test cô lập, Android development build và thiết bị/emulator được adb nhận; browser host hoạt động nếu kiểm preview. Bundle pass không thay proof native.

1. Customer lấy quote thật → xác nhận hai lần nhanh: chỉ một chuyến. Kiểm trạng thái processing, SEARCHING không tự hết xe theo thời gian, rồi ASSIGNED/ARRIVED/IN_PROGRESS/COMPLETED qua Driver thật; đúng snapshot tài xế/xe, không có ETA/GPS giả.
2. Ngắt mạng sau create/cancel khi server đã nhận. Khởi động lại native app/đăng nhập lại: active/journal được đọc trước lệnh mới. Retry dùng đúng key/body; receipt cũ không kéo status/version lùi; pending create đã completed đi qua replay/detail về tổng kết.
3. Xác nhận hủy đồng thời Driver bắt đầu: một kết quả theo server; conflict đọc lại, không tự đổi version/key để hủy tiếp. Hủy đã rõ có tổng kết; chưa rõ giữ journal và khóa lượt đặt mới.
4. Mất WebSocket rồi nối lại, event trùng/dồn, mất REST, background/foreground và đổi tab. Kiểm giữ snapshot/cảnh báo, không giả “không có chuyến”, một stream/poll và không còn timer sau logout/unmount.
5. Logout/đổi account khi GET/POST/refresh đang chờ: dữ liệu hoặc command response cũ không xuất hiện ở account mới. Kiểm Customer/Driver regression, font scale, bảng cuộn và Back route detail.
6. Kết thúc chuyến: hiển thị tổng kết đúng completed/cancelled, giá chốt/dự kiến đúng dữ liệu; mở detail rồi Back. Chỉ mở draft mới khi Trip/journal đã được kiểm tra, lấy quote mới trước gửi.

## Bàn giao

Giữ store/journal cấp phiên, preflight/final reconciliation và nguồn REST có version. Không áp event payload thành Trip, không xóa known Trip chỉ vì active null, không cho receipt cũ thay Trip khác và không tự replay bằng key mới. Không thêm geocoding, thanh toán, chat, rating, push hoặc GPS tài xế cho Customer. Bước 4–5 và live/device acceptance còn riêng, chỉ thực hiện trong phạm vi được giao.
