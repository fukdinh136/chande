package com.chande.userservice.adapter.persistence;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;

import java.time.Duration;

public final class DataSourceFactory {

    private DataSourceFactory() {
    }

    /** Pool HikariCP. Không kết nối được DB lúc khởi động thì ném lỗi ngay. */
    public static HikariDataSource create(String jdbcUrl, String username, String password, int poolSize) {
        HikariConfig config = new HikariConfig();
        config.setPoolName("user-service-db");
        config.setJdbcUrl(jdbcUrl);
        config.setUsername(username);
        config.setPassword(password);
        config.setMaximumPoolSize(poolSize);
        config.setConnectionTimeout(Duration.ofSeconds(10).toMillis());
        return new HikariDataSource(config);
    }
}
