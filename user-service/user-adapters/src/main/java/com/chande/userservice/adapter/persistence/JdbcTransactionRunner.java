package com.chande.userservice.adapter.persistence;

import com.chande.userservice.application.port.TransactionRunner;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.Objects;
import java.util.function.Supplier;

/**
 * Transaction JDBC thủ công. Connection của transaction nằm trong {@link ThreadLocal}: mỗi request chạy trên một
 * virtual thread riêng nên an toàn. Isolation mặc định của PostgreSQL (READ COMMITTED), như v1.
 */
public final class JdbcTransactionRunner implements TransactionRunner, ConnectionProvider {

    private static final Logger log = LoggerFactory.getLogger(JdbcTransactionRunner.class);

    private final DataSource dataSource;
    private final ThreadLocal<Connection> current = new ThreadLocal<>();

    public JdbcTransactionRunner(DataSource dataSource) {
        this.dataSource = Objects.requireNonNull(dataSource);
    }

    @Override
    public <T> T inTransaction(Supplier<T> work) {
        return run(work, false);
    }

    @Override
    public <T> T readOnly(Supplier<T> work) {
        return run(work, true);
    }

    @Override
    public <T> T withConnection(SqlWork<T> work) {
        try {
            Connection tx = current.get();
            if (tx != null) {
                return work.run(tx);
            }
            try (Connection connection = dataSource.getConnection()) {
                return work.run(connection);
            }
        } catch (SQLException e) {
            throw SqlErrors.translate(e);
        }
    }

    private <T> T run(Supplier<T> work, boolean readOnly) {
        if (current.get() != null) {
            return work.get(); // lồng nhau: dùng chung transaction ngoài
        }
        Connection connection = open();
        try {
            connection.setAutoCommit(false);
            if (readOnly) {
                connection.setReadOnly(true);
            }
            current.set(connection);
            T result;
            try {
                result = work.get();
            } catch (RuntimeException | Error e) {
                rollbackQuietly(connection, e);
                throw e;
            }
            connection.commit();
            return result;
        } catch (SQLException e) {
            rollbackQuietly(connection, e);
            throw SqlErrors.translate(e);
        } finally {
            current.remove();
            closeQuietly(connection); // Hikari tự khôi phục autoCommit/readOnly khi trả connection về pool
        }
    }

    private Connection open() {
        try {
            return dataSource.getConnection();
        } catch (SQLException e) {
            throw SqlErrors.translate(e);
        }
    }

    private static void rollbackQuietly(Connection connection, Throwable cause) {
        try {
            if (!connection.getAutoCommit()) {
                connection.rollback();
            }
        } catch (SQLException e) {
            cause.addSuppressed(e);
            log.warn("Rollback failed", e);
        }
    }

    private static void closeQuietly(Connection connection) {
        try {
            connection.close();
        } catch (SQLException e) {
            log.warn("Closing connection failed", e);
        }
    }
}
