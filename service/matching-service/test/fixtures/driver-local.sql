-- Isolated local smoke fixture only. Never apply to an existing Driver database.
CREATE TABLE drivers(id uuid PRIMARY KEY,phone_number varchar(15) NOT NULL UNIQUE,password_hash varchar(255) NOT NULL,full_name varchar(100) NOT NULL,avatar_url text,license_number varchar(20) NOT NULL UNIQUE,status varchar(20) NOT NULL CHECK(status IN ('ONLINE','OFFLINE')),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE vehicles(id uuid PRIMARY KEY,driver_id uuid NOT NULL REFERENCES drivers(id),vehicle_type varchar(20) NOT NULL,license_plate varchar(15) NOT NULL UNIQUE,brand_model varchar(100) NOT NULL,color varchar(30) NOT NULL,is_active boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE driver_refresh_tokens(id uuid PRIMARY KEY,driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,token_hash varchar(64) NOT NULL UNIQUE,expires_at timestamptz NOT NULL,revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO drivers(id,phone_number,password_hash,full_name,license_number,status) VALUES
('10000000-0000-4000-8000-000000000004','84900000004','local-otp-fixture','Local CAR 4 Driver','LOCAL-CAR4','OFFLINE'),
('10000000-0000-4000-8000-000000000007','84900000007','local-otp-fixture','Local CAR 7 Driver','LOCAL-CAR7','OFFLINE');
INSERT INTO vehicles(id,driver_id,vehicle_type,license_plate,brand_model,color,is_active) VALUES
('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000004','CAR_4','LOCAL-4','Local Car','White',true),
('20000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000007','CAR_7','LOCAL-7','Local Car','White',true);
