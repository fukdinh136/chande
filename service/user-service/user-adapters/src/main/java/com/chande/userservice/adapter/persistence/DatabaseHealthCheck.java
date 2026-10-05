package com.chande.userservice.adapter.persistence;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.function.BooleanSupplier;

/** {@code SELECT 1} tới DB. */
public final class DatabaseHealthCheck implements BooleanSupplier {

    private static final Logger log = LoggerFactory.getLogger(DatabaseHealthCheck.class);

    private final DataSource dataSource;

    public DatabaseHealthCheck(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @Override
    public boolean getAsBoolean() {
        try (Connection connection = dataSource.getConnection(); Statement statement = connection.createStatement()) {
            statement.setQueryTimeout(3);
            statement.execute("SELECT 1");
            return true;
        } catch (SQLException e) {
            log.warn("Health check failed: {}", e.getMessage());
            return false;
        }
    }
}
