# OSRM thật cho Hà Nội

Ngày 06/10/2026. Người dùng chọn tự host OSRM bằng Docker cho Hà Nội. Routing vẫn dùng Node.js/TypeScript; OSRM là backend C++ riêng, gọi qua HTTP. Bật CAR trước, BIKE chưa có profile xe máy được xác nhận.

## Cấu hình đã triển khai

| Phần | Giá trị |
| --- | --- |
| OSRM | `v26.10.0-debian`, pin digest trong Dockerfile và settings |
| Algorithm/profile | MLD, `/opt/car.lua`, URL profile `driving` |
| Dữ liệu | OSM Việt Nam từ Geofabrik, cắt bbox `[105.3,20.6,106.2,21.4]` theo thứ tự west,south,east,north |
| Phạm vi | Hà Nội và vùng đệm lân cận; bbox không phải ranh giới hành chính chính xác |
| Host endpoint | `http://127.0.0.1:5000`, chỉ publish loopback |
| Routing container endpoint | `http://osrm:5000`, network Docker `chande-osrm` |
| Auth | `none`, không cần API key cho OSRM gốc; private HTTP được bật tường minh |
| Vehicle types | CAR; profile BIKE null, không fallback sang car/bicycle |
| Realtime | Mock riêng; không đổi thành real chỉ vì OSRM real |
| Tài nguyên | Osmium clip tối đa 4 GiB; OSRM preprocess 2 GiB/2 CPU; backend 1 GiB/2 threads |

Nguồn chính thức: [OSRM Docker và MLD](https://github.com/Project-OSRM/osrm-backend/blob/v26.10.0/README.md), [image registry](https://github.com/Project-OSRM/osrm-backend/pkgs/container/osrm-backend), [Geofabrik Việt Nam](https://download.geofabrik.de/asia/vietnam.html), [Osmium extract](https://docs.osmcode.org/osmium/latest/osmium-extract.html). Pipeline: `osmium extract --strategy complete_ways` → `osrm-extract` → `osrm-partition` → `osrm-customize` → `osrm-routed --algorithm mld`.

`complete_ways` giữ đầy đủ node của way giao với vùng cắt, hỗ trợ routing gần biên. Dataset không cung cấp traffic thời gian thực; duration là ước lượng từ profile/dữ liệu. Không chọn public demo làm dependency.

## Chạy cùng Trip và Price

Điều kiện: Docker Desktop Linux containers, Node.js 24/npm, Internet khi tải image/dataset lần đầu, Docker khoảng 8 GiB RAM. Từ `service/trip-service`:

```powershell
npm.cmd run local:osrm
npm.cmd run smoke:osrm
docker compose -f compose.local.yml -f compose.osrm.yml ps
```

`local:osrm` chuẩn bị dataset nếu chưa có, khởi động OSRM/đợi healthy, build và khởi động stack Trip với overlay OSRM. Overlay nối Routing vào network OSRM và chỉ bật CAR ở API/worker Trip; dữ liệu/volume Trip hiện có được giữ. Price vẫn tính biểu giá mẫu CAR, Matching/Gateway/Notification/JWT issuer local vẫn mock.

Thao tác riêng từ `service/routing-service`:

```powershell
npm.cmd run osrm:prepare
npm.cmd run osrm:up
npm.cmd run smoke:osrm # Cần stack Trip+Price đang chạy với overlay
```

Backend có curl HTTP healthcheck và restart policy, chạy non-root/read-only với graph bind mount read-only. Probe Route dùng tọa độ Hà Nội. Graph phải được chuẩn bị trước; Compose không tự tạo thư mục dữ liệu thiếu. Readiness Routing kiểm tra nội bộ, không đại diện availability OSRM; smoke trực tiếp kiểm tra dependency.

## Dữ liệu và chạy lại

- Settings ở [osrm/settings.json](../osrm/settings.json), Compose backend ở [osrm/compose.yml](../osrm/compose.yml), overlay Trip ở [compose.osrm.yml](../../trip-service/compose.osrm.yml).
- Script tải `vietnam-latest.osm.pbf` tối đa 512 MiB, kiểm tra MD5 từ nguồn trước preprocess và ghi SHA-256. File quốc gia tạm được xóa sau khi graph/manifest thành công; chỉ giữ extract Hà Nội và graph.
- Graph/PBF/manifest nằm trong `osrm/data/hanoi-car/`, được Git/Docker build context ignore. Manifest ghi source URL, checksum, thời điểm, bbox, profile, algorithm, image digest và checksum extract. `latest` ở nguồn thay đổi theo thời gian; manifest xác định snapshot đã tải, không giả định mọi lần chạy có cùng dataset.
- Chạy prepare lần nữa kiểm tra manifest/checksum extract và các artifact MLD bắt buộc, dùng lại graph đã chuẩn bị; không download/rebuild âm thầm. Nếu build chưa hoàn thành hoặc settings thay đổi, script dừng để tránh ghi đè graph đang dùng. Giữ thư mục lỗi để chẩn đoán rồi chuyển ra ngoài đường dẫn build trước khi retry.
- Muốn cập nhật dữ liệu: build trong thư mục version riêng, smoke, dừng backend/chuyển mount sang snapshot mới rồi khởi động lại; giữ snapshot cũ để rollback. Không preprocess trực tiếp lên graph backend đang đọc. Không xóa volume Trip.
- Attribution: © OpenStreetMap contributors, [ODbL 1.0](https://www.openstreetmap.org/copyright), nguồn Geofabrik. Ứng dụng hiển thị kết quả/dữ liệu cần giữ attribution phù hợp.

## Chạy Routing source

[.env.osrm.example](../.env.osrm.example) là cấu hình riêng để không ghi đè `.env` hoặc profile local đang có. Sao chép thành `.env.osrm.local` nếu chưa có, điền ba caller token khác nhau, giữ Trip token khớp `ROUTING_TOKEN` ở Trip. Khi API Docker đang dùng port 3004, dừng `routing-api` trước khi chạy source:

```powershell
npm.cmd run build
node --env-file=.env.osrm.local dist/main.js
```

OSRM localhost URL chỉ dùng khi Routing ở host; trong container dùng DNS `osrm`. HTTP allowlist chỉ chứa host được chọn. Không bật `NODE_ENV=production` cho bộ local này: production còn cần Realtime thật và credentials/network vận hành đã xác nhận.

## Kiểm chứng và giới hạn

Kết quả local ngày 06/10/2026:

- Routing `npm run test:all`: 43 tests đạt; thêm ca profile CAR real/BIKE chưa được bật. Lint, strict TypeScript compile và Docker Routing build đạt. Trip lint đạt.
- Pipeline download/checksum/clip/extract/partition/customize thành công. Chạy prepare lần hai dùng lại dataset, không tải/build lại. Nguồn Việt Nam 329.770.361 bytes; extract/graph/manifest giữ khoảng 518 MiB, file tải quốc gia đã xóa.
- OSRM runtime non-root/read-only healthy, Trip/worker/Price/Routing healthy. Publish graph có bước `chmod 644` vì file mmap `fileIndex` do OSRM tạo ban đầu có mode 0700.
- Backend restart trong grace 10 giây thành công, trở lại healthy; Route/Table/quote smoke sau restart cũng đạt.
- `npm run smoke:osrm` từ Trip đạt: Route/full geometry + steps/recalculate/Table qua API Routing khớp OSRM trực tiếp; Trip quote và journey hoàn thành/hủy đạt. Tuyến fixture `[105.8542,21.0285]` → `[105.8355,21.0272]`: 2.546 m, 258 giây, CAR 27.460đ theo policy mẫu.
- Dataset extract SHA-256 `a697f5c1e29b93a4df43d27c0700d2dec9cffe24b32743a74c941acfc74e405c`; source SHA-256 `0e82abe0dc668e8194a36fc95a1cc10be5fea9becc3088efe00fea0bb1983698`. Manifest đầy đủ nằm ở thư mục ignored; không commit binary.
- UTF-8, local links và JSON examples đạt qua `docs:check`. CI có thêm validate Compose OSRM và build image; không tải dataset Việt Nam mỗi lần CI. Checks GitHub chưa được ghi nhận trong báo cáo này.

`smoke:osrm` đối chiếu kết quả Routing với Route/Table trực tiếp từ OSRM cho tọa độ Hà Nội: đúng hai trường estimate đã ceil, geometry/steps, recalculate, hai driver→pickup matrix có identity đúng và reject BIKE. Vị trí hai driver ở matrix vẫn là fixture của Realtime, phần tính đường/ETA là OSRM thật. Quote Trip được đối chiếu route và công thức Price, tiếp theo smoke journey kiểm tra create/replay/nhận/hoàn thành/hủy và giá chốt.

Đây là triển khai local theo bbox, chưa phải hosting/HA hay benchmark production. Chưa xác nhận policy vùng phục vụ/snapping khi khách nhập điểm ngoài dataset; chỉ nghiệm thu trong vùng Hà Nội. Chưa triển khai profile xe máy, traffic feed hoặc Realtime HTTP wire adapter.

## Dừng hoặc quay về map mock

```powershell
# Từ service/trip-service: đổi lại cấu hình mock, giữ dữ liệu.
docker compose -f compose.local.yml up -d --wait
# Từ service/routing-service: dừng backend OSRM.
docker compose -f osrm/compose.yml stop
```

Nếu dừng Trip đang dùng OSRM, luôn truyền cả `-f compose.local.yml -f compose.osrm.yml` để Compose nhận đầy đủ topology. Không dùng `down -v` khi muốn giữ dữ liệu.
