# Bước 4/5 — Lịch sử, đặt lại và tài khoản Customer

| Thuộc tính | Giá trị |
| --- | --- |
| Service | Customer App / Driver App |
| Rà soát | 2026-11-18 |
| Quy ước | [Format và số liệu](../quy-uoc-tai-lieu.md) |

## Phạm vi và khảo sát

Đã triển khai bước 4 trong `app/`, tiếp nối [bước 3](buoc-3-vong-doi-chuyen.md). Giữ các thay đổi bước 1–3 đang có, Android package/build config, web memory session, journal/idempotency của chuyến và cơ chế refresh token. Không sửa backend, thêm endpoint/dependency, dữ liệu giả, upload ảnh, geocoding, thanh toán, chat, đánh giá hoặc push. Bước 5 chưa được thực hiện.

Đọc AGENTS root/app, [phạm vi UI](pham-vi-ui.md), [API frontend](api.md), [API Trip](../../service/trip-service/docs/api.md), schema/source Trip và User, [User v2](../../service/user-service/docs/user-service-v2.md), Expo SDK 57/Router. Đọc DESIGN/HTML và xem PNG [lịch sử](../../stitch_ride_hailing_customer_app_ui/ride_history/screen.png), [tài khoản](../../stitch_ride_hailing_customer_app_ui/profile_settings/screen.png). Giữ Inter/teal, card hành trình, bộ lọc và nhóm tài khoản; bỏ dữ liệu mẫu, tổng chi tiêu/CO2, payment/rating và tính năng chưa có API.

Trước bước này đã có route detail riêng, phân trang đơn giản và form tài khoản gộp. Chưa nối tham số lọc dù adapter có sẵn, chưa đặt lại, avatar chưa fallback khi tải lỗi, nhãn địa chỉ null bị decoder từ chối, mỗi nơi đọc địa chỉ riêng và xóa chưa xác nhận.

## Hợp đồng thực tế

| Phần | Hành vi áp dụng |
| --- | --- |
| Lịch sử | GET `/api/v1/trips/history`, `limit=20`, cursor opaque và `status=COMPLETED/CANCELLED`; bỏ status để lấy cả hai. Server lọc trên toàn lịch sử của principal, không lọc riêng trang client |
| Cursor | Scope theo principal/filter; đổi filter phải bỏ cursor. Keyset theo requestedAt/tripId giảm dần, không cam kết snapshot khi có chuyến mới kết thúc |
| Chi tiết | GET `/api/v1/trips/:id` trả Trip và statusHistory thực. 404 gộp không tồn tại/không được xem; UI không suy ra owner. 403 và lỗi mạng có thông báo/retry |
| Hồ sơ | PATCH `/api/v1/users/me`, tên tối đa 100, avatar URL HTTP(S) tối đa 500. Null là giữ nguyên; không xóa avatar bằng chuỗi rỗng. Giới hạn này được ghi ngay trong form |
| Mật khẩu | POST `/api/v1/users/me/password`, oldPassword/newPassword. Quy tắc source gồm 8–72 ký tự, chữ Latin/số, tối đa 72 byte UTF-8; không trùng mật khẩu hiện tại. `passwordChanged=true` thì xóa phiên local và đăng nhập lại |
| Địa chỉ | GET/POST/PUT/DELETE và PUT default hiện có; tối đa 10, nhãn tùy chọn <=50, addressText bắt buộc <=500, lat [-90,90], lng [-180,180]. Nhãn null dùng addressText để hiển thị |
| Mặc định | Địa chỉ đầu tự mặc định; PUT makeDefault=false giữ cờ cũ; xóa mặc định có thể chuyển sang địa chỉ mới nhất. GET canonical sau ghi để đọc lại thứ tự/default thật |

Giá và thành phần chi phí giữ chuỗi, không Number. Chỉ hiển thị route/breakdown khi có; thành phần hiện tại từ Price là BASE_FARE/DISTANCE_FARE. Timeline chỉ dùng statusHistory, không dựng mốc từ trạng thái cuối hoặc lấy thời điểm thiết bị thay thời điểm thiếu. Không gọi chi phí là biên lai thanh toán.

## Triển khai và file chính

- [Booking store](../../app/src/features/customer/booking-store.ts): lịch sử cùng scope phiên, filter server, khóa tải đồng bộ ngay khi bấm, cursor riêng filter, abort/revision/owner chống phản hồi cũ. Tải lỗi giữ items/cursor và phân biệt retry trang đầu/trang tiếp. Gộp bản ghi theo Trip ID, không hạ version; cursor lặp bị coi là response lỗi. Không tự tải hết lịch sử.
- [History](../../app/src/features/customer/history.tsx) và [card Customer](../../app/src/features/customer/history-card.tsx): hành trình, thời gian thật/fallback, giá dự kiến/chốt, trạng thái, tài xế nếu có; initial loading, refresh, empty đã xác minh, error/retry/load more. Không hiện global empty khi còn cursor.
- [Detail](../../app/src/features/customer/trip-detail.tsx): route `/customer/trips/[id]` tự GET theo ID, kiểm response đúng ID và fence owner/abort. Hiển thị tài xế/xe khi có, quãng đường/thời gian hành trình, tiền/breakdown và timeline thực. Back/fallback lịch sử giữ nguyên.
- [Rebook action](../../app/src/features/customer/rebook-action.tsx): chỉ chuẩn bị pickup/destination/CAR_4 hoặc CAR_7 hợp lệ của chuyến terminal. Có xác nhận thay draft, revision thay đổi thì hỏi lại. Fresh REST kiểm tra active trước khi điền; pending journal, active Trip, lỗi đối soát hoặc đổi owner đều chặn. Chép điểm thành giá trị riêng, bỏ quote/clock/preview cũ, sang chọn xe. Không POST, không tự quote, không mang key/giá cũ sang lượt mới.
- [Account](../../app/src/features/customer/account.tsx): chia Hồ sơ / Địa chỉ yêu thích / Bảo mật. [Profile form](../../app/src/features/customer/profile-form.tsx), [security form](../../app/src/features/customer/security-form.tsx), [validation](../../app/src/features/customer/account-form.ts), [owned form](../../app/src/features/customer/use-owned-form.ts) tách trách nhiệm, khóa bấm lặp ngay bằng ref, lỗi field được ánh xạ sang tiếng Việt. Lỗi lưu giữ nội dung nhập; mật khẩu chỉ ở state của form, không log hay ghi storage.
- [UserSession](../../app/src/features/backend/user-session.ts): lưu profile bằng response đã giải mã, không buộc GET phụ thành công mới xác nhận lưu. Request đã abort/đổi owner không cập nhật profile; đổi mật khẩu chỉ logout khi có response đúng hợp đồng và cùng owner. Giữ refresh/restore/web session hiện có.
- [Avatar dùng chung](../../app/src/features/ui/avatar.tsx): hỗ trợ URL theo hợp đồng; ảnh tải lỗi về initials, URL khác có thể tải lại. Có regression Driver khi thay phần dùng chung.
- [Data store](../../app/src/features/customer/data-store.ts) và [provider](../../app/src/features/customer/data-provider.tsx): một danh sách địa chỉ theo phiên, dùng chung tài khoản/editor/[picker booking](../../app/src/features/customer/saved-places.tsx). Khóa write, loại GET cũ, abort khi kết thúc owner. Response ghi đã xác nhận được giữ ngay cả khi GET sau đó lỗi; cảnh báo load vẫn hiển thị, không biến thành empty.
- [Editor](../../app/src/features/customer/place-editor.tsx): route riêng `/customer/places/new` và `/customer/places/[id]`, form + map + tọa độ, nhãn tùy chọn và mặc định. Điểm mở map không tự thành tọa độ. Ngoài miền Mercator vẫn nhập tọa độ theo API nhưng không đặt marker không hợp lệ; booking kiểm miền hỗ trợ riêng. [Danh sách địa chỉ](../../app/src/features/customer/places-panel.tsx) có xác nhận xóa và giữ xác nhận/form khi thất bại. Chọn địa chỉ vào booking vẫn cần xác nhận điểm; sửa/xóa nguồn không đổi snapshot điểm đã chọn.

## Tiêu chí hoàn thành

| Tiêu chí | Kết quả | Bằng chứng / giới hạn |
| --- | --- | --- |
| Lịch sử/chi tiết/đặt lại/tài khoản nối luồng Customer | Đạt ở source/tests | Guard phiên, route theo ID, Back, tab booking và địa chỉ dùng chung |
| Lọc không gây hiểu sai | Đạt ở source/tests | API server-filter, reset cursor, ignore old response, giữ dữ liệu khi lỗi |
| Đặt lại luôn cần giá mới | Đạt ở tests | Quote/line bị bỏ; không tạo command/key hoặc POST/quote tự động; kiểm active/journal và xác nhận draft |
| Lưu lỗi không mất form | Đạt ở UI tests | Profile, password và địa chỉ; retry, double tap, server field errors và đổi owner |
| Nghiệm thu backend/Android/preview tương tác | Chưa đạt | Chưa chạy live API/Android trong bước này; browser host không khả dụng |

## Kiểm tra ngày 2026-11-18

Node 24; chạy các lệnh app trong `app/`. Mock chỉ ở test/native/network/router/storage boundaries, không đưa mock vào luồng thật.

| Lệnh | Kết quả |
| --- | --- |
| `npm.cmd run lint` | Pass, không lỗi/warning ESLint |
| `npm.cmd run typecheck` | Pass |
| `npm.cmd test` | 145 test: 140 pass, 0 fail, 5 integration skip; gồm hồi quy Driver và bước 1–3 |
| `node --test test/customer-step4.test.cjs test/customer-step4-ui.test.cjs` | 22 pass, 0 fail: filter/page errors, rebook, địa chỉ/default/cache, profile/password/UTF-8, giữ form, xác nhận xóa, owner/abort và avatar fallback |
| Customer Android/web export, Driver Android export | Pass JS/Hermes/static bundle; dùng `APP_VARIANT=customer/driver`, `CI=1`, `npm.cmd exec -- expo export --platform android/web --output-dir .expo/step4-<variant>-<platform> --max-workers 2` |
| `node scripts/validate-docs.cjs` và `git diff --check` từ root | Pass: 66 tài liệu UTF-8, 552 local links, 54 JSON examples, 27 source contract checks; diff không có lỗi whitespace |
| CUA browser inventory | Không có browser; host báo không khả dụng. Chưa kiểm visual/tương tác hoặc chụp screenshot |

Typed route declarations trong `.expo/types` được tái sinh bằng generator Expo CLI đã cài sau khi thêm route; không nới type hoặc ép cast để bỏ lỗi. Build outputs/logs ở `.expo/` được ignore. Không đổi dependency/lockfile hoặc sửa native generated. Warning deprecation react-test-renderer hiện có được giữ.

API địa chỉ chưa có idempotency/version. Form giữ nội dung khi request lỗi, nhưng timeout không chứng minh server chưa ghi; cần tải lại danh sách trước khi quyết định thêm lại. Snapshot cache địa chỉ/lịch sử chỉ trong phiên, không phải offline persistence mới. Đăng xuất vẫn giữ journal chuyến theo scope owner để khôi phục an toàn khi đăng nhập lại, không dùng sang account khác.

## Checklist thủ công còn lại

Cần Gateway/backend test đầy đủ, RIDER có lịch sử nhiều trang và DRIVER test; Android build đã cài, thiết bị/emulator và Metro đúng variant. Cần browser host hoạt động nếu kiểm preview. Bundle pass không thay nghiệm thu APK/cảm biến hoặc API thật.

1. Lịch sử nhiều hơn 20 chuyến: Tất cả/Hoàn thành/Đã hủy, đổi filter khi tải, load more hai lần nhanh, ngắt mạng ở trang đầu/trang tiếp, retry và refresh; không mất list hoặc trùng Trip.
2. Mở detail bằng ID/deep link, thử ID không được xem, mất mạng/retry và Back. Đối chiếu timeline/breakdown với response thật, không có mốc/chi phí tự dựng.
3. Đặt lại khi chưa có draft, có draft, quote cũ, chuyến active hoặc journal chưa rõ. Chỉ thay draft khi xác nhận và đối soát hợp lệ; bắt buộc lấy quote mới trước create.
4. Hồ sơ: tên/URL sai, ảnh hỏng, save lỗi rồi retry, avatar hiện có để trống; nội dung giữ, không có upload/xóa ảnh giả. Bảo mật: sai mật khẩu cũ, xác nhận lệch, password UTF-8 quá dài, đổi thành công cần đăng nhập lại.
5. Địa chỉ: tạo bằng map/tọa độ, nhãn trống, sửa/default, lỗi lưu, xác nhận/giữ/hủy xóa, xóa mặc định. Picker booking cập nhật dữ liệu mới nhưng tọa độ booking đã xác nhận giữ nguyên.
6. Logout/đổi account khi history/detail/places/profile đang chạy. Không hiện dữ liệu/success của owner cũ; kiểm request/socket cleanup, thử lại Customer/Driver, bàn phím/font scale/Back trên Android.

## Bàn giao

Giữ history server-filter và cursor scope; không thay thành client filter rồi gọi empty cho toàn lịch sử. Giữ preflight/revision khi đặt lại và không chuyển giá/key cũ. Giữ address collection dùng chung theo owner và snapshot booking độc lập. Bước 5 và nghiệm thu backend/thiết bị vẫn cần thực hiện khi được giao, không coi kết quả source/unit/bundle là đã chạy thực tế.
