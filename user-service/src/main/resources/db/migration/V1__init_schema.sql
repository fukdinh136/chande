-- V1: cấu trúc ban đầu của user-service, GIỐNG HỆT các bảng trước đây tạo bằng SQL tay (bước 1, 2, 9),
-- kể cả 2 chỗ lệch với entity được sửa ở V2. Giữ nguyên để DB cũ và DB mới đi qua cùng một lịch sử.
-- DB đã có sẵn bảng: Flyway đánh dấu (baseline) là version 1 và KHÔNG chạy file này.
-- DB trống (máy mới, demo): Flyway chạy file này rồi chạy tiếp V2.

CREATE TABLE users (
    id            uuid         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    phone_number  varchar(15)  NOT NULL,
    password_hash varchar(255) NOT NULL,
    full_name     varchar(100) NOT NULL,
    avatar_url    text,
    status        varchar(20)  NOT NULL DEFAULT 'ACTIVE',
    created_at    timestamptz  NOT NULL DEFAULT now(),
    updated_at    timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uk_users_phone_number UNIQUE (phone_number),
    CONSTRAINT ck_users_status CHECK (status IN ('ACTIVE', 'BLOCKED'))
);

-- Chỉ lưu SHA-256 của refresh token; revoked_at chỉ mang nghĩa "đã xoay vòng" (bước 8.3a)
CREATE TABLE user_refresh_tokens (
    id         uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id    uuid        NOT NULL,
    token_hash varchar(64) NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uk_user_refresh_tokens_token_hash UNIQUE (token_hash),
    CONSTRAINT fk_user_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX ix_user_refresh_tokens_user_id ON user_refresh_tokens (user_id);

CREATE TABLE user_addresses (
    id           uuid           NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id      uuid           NOT NULL,
    label        varchar(50),
    address_text varchar(50),
    lat          numeric(10, 8),
    lng          numeric(11, 8) NOT NULL,
    is_default   boolean        NOT NULL DEFAULT false,
    created_at   timestamptz    NOT NULL DEFAULT now(),
    CONSTRAINT ck_user_addresses_lat CHECK (lat >= -90 AND lat <= 90),
    CONSTRAINT ck_user_addresses_lng CHECK (lng >= -180 AND lng <= 180),
    CONSTRAINT fk_user_addresses_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX ix_user_addresses_user_id ON user_addresses (user_id);
-- Mỗi người dùng có tối đa 1 địa chỉ mặc định
CREATE UNIQUE INDEX ux_user_addresses_one_default ON user_addresses (user_id) WHERE is_default;
