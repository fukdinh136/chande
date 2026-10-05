package com.chande.userservice.adapter.persistence;

import org.flywaydb.core.Flyway;

import javax.sql.DataSource;

/**
 * Flyway với lịch sử của v1 ({@code db/migration/V1__..., V2__...}, không được sửa nội dung).
 * {@code baselineOnMigrate + baselineVersion=1}: DB cũ có bảng tạo bằng tay được đánh dấu là V1 rồi chạy tiếp V2.
 */
public final class Migrations {

    private Migrations() {
    }

    public static void run(DataSource dataSource) {
        Flyway.configure()
                .dataSource(dataSource)
                .locations("classpath:db/migration")
                .baselineOnMigrate(true)
                .baselineVersion("1")
                .load()
                .migrate();
    }
}
