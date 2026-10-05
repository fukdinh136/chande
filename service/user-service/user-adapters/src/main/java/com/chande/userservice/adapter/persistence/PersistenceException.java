package com.chande.userservice.adapter.persistence;

import java.sql.SQLException;

/** Lỗi DB không lường trước (mất kết nối, lỗi SQL...): trả 500, chi tiết chỉ nằm trong log. */
public final class PersistenceException extends RuntimeException {

    public PersistenceException(SQLException cause) {
        super("Database error (SQLState " + cause.getSQLState() + ")", cause);
    }
}
