#!/bin/sh
set -eu
migration_password="$(cat /run/secrets/migration-password)"
runtime_password="$(cat /run/secrets/runtime-password)"
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 --set=migration_password="$migration_password" --set=runtime_password="$runtime_password" <<'SQL'
CREATE ROLE trip_migrator LOGIN PASSWORD :'migration_password';
CREATE ROLE trip_runtime LOGIN PASSWORD :'runtime_password';
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA trip AUTHORIZATION trip_migrator;
GRANT CONNECT ON DATABASE trip TO trip_migrator, trip_runtime;
GRANT USAGE ON SCHEMA trip TO trip_runtime;
ALTER ROLE trip_migrator SET search_path=trip,public;
ALTER ROLE trip_runtime SET search_path=trip,public;
ALTER DEFAULT PRIVILEGES FOR ROLE trip_migrator IN SCHEMA trip GRANT SELECT,INSERT,UPDATE ON TABLES TO trip_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE trip_migrator IN SCHEMA trip GRANT USAGE,SELECT ON SEQUENCES TO trip_runtime;
SQL
