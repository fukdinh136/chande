package com.chande.userservice.adapter.persistence;

import com.chande.userservice.domain.common.DomainException;
import com.chande.userservice.domain.common.ErrorCode;
import org.postgresql.util.PSQLException;
import org.postgresql.util.ServerErrorMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.sql.SQLException;
import java.util.Set;

/** Đổi lỗi PostgreSQL (SQLState + tên constraint) thành mã lỗi API (mục 8). */
public final class SqlErrors {

    private static final Logger log = LoggerFactory.getLogger(SqlErrors.class);

    private static final String UNIQUE_VIOLATION = "23505";
    /** FK, unique, check: vi phạm ràng buộc do ghi đồng thời. */
    private static final Set<String> INTEGRITY_VIOLATIONS = Set.of("23503", UNIQUE_VIOLATION, "23514");
    /** serialization_failure, deadlock_detected: thử lại là được. */
    private static final Set<String> RETRYABLE = Set.of("40001", "40P01");

    private SqlErrors() {
    }

    public static RuntimeException translate(SQLException e) {
        String state = e.getSQLState();
        String constraint = constraintOf(e);
        if (UNIQUE_VIOLATION.equals(state) && "uk_users_phone_number".equals(constraint)) {
            return new DomainException(ErrorCode.PHONE_ALREADY_EXISTS);
        }
        if (INTEGRITY_VIOLATIONS.contains(state) || RETRYABLE.contains(state)) {
            // Không ghi message của PostgreSQL vì có thể chứa dữ liệu người dùng (VD: SĐT trong "Key (...)=(...)")
            log.warn("Data conflict: SQLState {}, constraint {}", state, constraint);
            return new DomainException(ErrorCode.DATA_CONFLICT);
        }
        return new PersistenceException(e);
    }

    private static String constraintOf(SQLException e) {
        if (e instanceof PSQLException psql) {
            ServerErrorMessage server = psql.getServerErrorMessage();
            return server == null ? null : server.getConstraint();
        }
        return null;
    }
}
