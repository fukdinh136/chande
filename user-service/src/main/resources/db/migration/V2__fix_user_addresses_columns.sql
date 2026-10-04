-- V2: sửa 2 chỗ bảng user_addresses lệch với entity UserAddress (phát hiện khi chuyển sang Flyway):
--   1. address_text là varchar(50) và cho NULL, trong khi entity/DTO cho phép 500 ký tự và bắt buộc.
--      Địa chỉ thật thường dài hơn 50 ký tự (VD "Keangnam Landmark 72, Phạm Hùng, Nam Từ Liêm, Hà Nội")
--      → bị DB từ chối.
--   2. lat cho NULL, trong khi entity bắt buộc.
-- ddl-auto: validate không phát hiện được vì Hibernate không so độ dài cột và NOT NULL.
ALTER TABLE user_addresses
    ALTER COLUMN address_text TYPE varchar(500),
    ALTER COLUMN address_text SET NOT NULL,
    ALTER COLUMN lat SET NOT NULL;
