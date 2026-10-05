package com.chande.userservice.adapter.support;

import com.chande.userservice.adapter.persistence.DataSourceFactory;
import com.chande.userservice.adapter.persistence.Migrations;
import org.junit.jupiter.api.Assumptions;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.postgresql.PostgreSQLContainer;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.regex.Pattern;

/**
 * PostgreSQL thật cho test lưu trữ, theo thứ tự ưu tiên:
 * <ol>
 *   <li>{@code TEST_DB_URL} (+ {@code TEST_DB_USERNAME}, {@code TEST_DB_PASSWORD}): DB có sẵn. Tên DB phải chứa
 *       "test" vì các bảng sẽ bị xoá và tạo lại;</li>
 *   <li>Testcontainers nếu có Docker;</li>
 *   <li>không có cả hai thì bỏ qua (skip) các test này.</li>
 * </ol>
 */
public final class TestDatabase {

    private static final Pattern TEST_DATABASE_NAME = Pattern.compile("^jdbc:postgresql://[^/]+/[^/?]*test[^/?]*(\\?.*)?$");

    private static DataSource dataSource;
    private static PostgreSQLContainer container;

    private TestDatabase() {
    }

    public static synchronized DataSource get() {
        if (dataSource != null) {
            return dataSource;
        }
        String url = System.getenv("TEST_DB_URL");
        if (url != null && !url.isBlank()) {
            if (!TEST_DATABASE_NAME.matcher(url).matches()) {
                throw new IllegalStateException("TEST_DB_URL must point to a database whose name contains 'test'");
            }
            dataSource = DataSourceFactory.create(url, env("TEST_DB_USERNAME", "postgres"), env("TEST_DB_PASSWORD", ""), 20);
        } else if (DockerClientFactory.instance().isDockerAvailable()) {
            container = new PostgreSQLContainer("postgres:16-alpine");
            container.start();
            dataSource = DataSourceFactory.create(container.getJdbcUrl(), container.getUsername(),
                    container.getPassword(), 20);
        } else {
            Assumptions.abort("No PostgreSQL for persistence tests: set TEST_DB_URL or start Docker");
        }
        execute(dataSource, "DROP TABLE IF EXISTS user_addresses, user_refresh_tokens, users, flyway_schema_history CASCADE");
        Migrations.run(dataSource);
        return dataSource;
    }

    /** Xoá sạch dữ liệu giữa các test (FK ON DELETE CASCADE kéo theo token và địa chỉ). */
    public static void truncate(DataSource ds) {
        execute(ds, "TRUNCATE users CASCADE");
    }

    public static void execute(DataSource ds, String sql) {
        try (Connection c = ds.getConnection(); Statement s = c.createStatement()) {
            s.execute(sql);
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String env(String name, String defaultValue) {
        String value = System.getenv(name);
        return value == null ? defaultValue : value;
    }
}
