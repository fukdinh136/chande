package com.chande.userservice.adapter.persistence;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

/** Đọc/ghi kiểu Java <-> cột PostgreSQL (uuid, timestamptz). */
final class JdbcSupport {

    private JdbcSupport() {
    }

    static void setInstant(PreparedStatement ps, int index, Instant value) throws SQLException {
        ps.setObject(index, value == null ? null : value.atOffset(ZoneOffset.UTC));
    }

    static Instant getInstant(ResultSet rs, String column) throws SQLException {
        OffsetDateTime value = rs.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }

    static UUID getUuid(ResultSet rs, String column) throws SQLException {
        return rs.getObject(column, UUID.class);
    }
}
