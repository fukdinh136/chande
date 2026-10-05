package com.chande.userservice.bootstrap;

import com.chande.userservice.adapter.http.BearerAuthenticator;
import com.chande.userservice.adapter.http.InternalKeyAuthenticator;
import com.chande.userservice.adapter.http.Router;
import com.chande.userservice.adapter.http.Routes;
import com.chande.userservice.adapter.http.UserHttpServer;
import com.chande.userservice.adapter.persistence.DataSourceFactory;
import com.chande.userservice.adapter.persistence.DatabaseHealthCheck;
import com.chande.userservice.adapter.persistence.JdbcAddressRepository;
import com.chande.userservice.adapter.persistence.JdbcRefreshTokenRepository;
import com.chande.userservice.adapter.persistence.JdbcTransactionRunner;
import com.chande.userservice.adapter.persistence.JdbcUserRepository;
import com.chande.userservice.adapter.persistence.Migrations;
import com.chande.userservice.adapter.security.BCryptPasswordHasher;
import com.chande.userservice.adapter.security.Rs256AccessTokenIssuer;
import com.chande.userservice.adapter.security.Rs256JwtVerifier;
import com.chande.userservice.adapter.security.RsaKeys;
import com.chande.userservice.adapter.security.SecureRefreshTokenFactory;
import com.chande.userservice.adapter.security.UuidGenerator;
import com.chande.userservice.application.address.AddressService;
import com.chande.userservice.application.auth.AuthService;
import com.chande.userservice.application.profile.ProfileService;
import com.sun.net.httpserver.HttpServer;
import com.zaxxer.hikari.HikariDataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.net.InetSocketAddress;
import java.time.Clock;
import java.time.Duration;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/** Điểm vào: đọc cấu hình, chạy migration, tự tay nối các đối tượng (không DI container), mở HTTP server. */
public final class Main {

    private static final Logger log = LoggerFactory.getLogger(Main.class);

    /** Mục 14.4: dọn refresh token đã hết hạn quá 1 ngày, mỗi giờ một lần. */
    private static final Duration PURGE_RETENTION = Duration.ofDays(1);
    private static final long PURGE_INTERVAL_MINUTES = 60;

    private Main() {
    }

    public static void main(String[] args) {
        // JDK HttpServer mặc định không có timeout đọc request/ghi response. Phải đặt trước khi lớp HttpServer nạp.
        setDefaultProperty("sun.net.httpserver.maxReqTime", "30");
        setDefaultProperty("sun.net.httpserver.maxRspTime", "30");

        AppConfig cfg;
        try {
            cfg = AppConfig.fromEnv(System.getenv());
        } catch (IllegalStateException e) {
            log.error(e.getMessage());
            System.exit(1);
            return;
        }
        try {
            start(cfg);
        } catch (Exception e) {
            log.error("User service failed to start", e);
            System.exit(1);
        }
    }

    static void start(AppConfig cfg) throws Exception {
        HikariDataSource ds = DataSourceFactory.create(cfg.db().url(), cfg.db().username(), cfg.db().password(),
                cfg.db().poolSize());
        Migrations.run(ds);

        Clock clock = Clock.systemUTC();
        JdbcTransactionRunner tx = new JdbcTransactionRunner(ds);
        var users = new JdbcUserRepository(tx);
        var refreshTokens = new JdbcRefreshTokenRepository(tx);
        var addresses = new JdbcAddressRepository(tx);
        var ids = new UuidGenerator();

        AppConfig.Jwt jwt = cfg.jwt();
        RsaKeys keys = RsaKeys.load(jwt.privateKeyFile(), jwt.keyId(), jwt.previousPublicKeysDir());
        var hasher = new BCryptPasswordHasher(cfg.bcryptCost(), Runtime.getRuntime().availableProcessors());
        var issuer = new Rs256AccessTokenIssuer(keys.current(), jwt.issuer(), jwt.audience(), jwt.accessTokenTtl());
        var verifier = new Rs256JwtVerifier(keys.all(), jwt.issuer(), jwt.clockSkew(), clock);

        var auth = new AuthService(users, refreshTokens, hasher, issuer, new SecureRefreshTokenFactory(), ids, tx,
                clock, jwt.refreshTokenTtl());
        var profile = new ProfileService(users, tx, clock);
        var address = new AddressService(addresses, users, ids, tx, clock);

        Router router = Routes.build(auth, profile, address, keys.jwks(), new DatabaseHealthCheck(ds),
                new BearerAuthenticator(verifier), new InternalKeyAuthenticator(cfg.internalApiKey()),
                cfg.maxBodyBytes());
        HttpServer server = UserHttpServer.start(new InetSocketAddress(cfg.port()), router);

        ScheduledExecutorService maintenance = Executors.newSingleThreadScheduledExecutor(
                Thread.ofPlatform().daemon().name("refresh-token-purge").factory());
        maintenance.scheduleWithFixedDelay(() -> purgeExpiredTokens(auth), 1, PURGE_INTERVAL_MINUTES, TimeUnit.MINUTES);

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            log.info("Shutting down, waiting up to {} for in-flight requests", cfg.shutdownGrace());
            maintenance.shutdownNow();
            server.stop((int) cfg.shutdownGrace().toSeconds());
            ds.close();
            log.info("User service stopped");
        }, "shutdown"));

        log.info("User service listening on port {} (JWT issuer {}, kid {}, {} key(s) in JWKS)", cfg.port(),
                jwt.issuer(), keys.current().kid(), keys.all().size());
    }

    private static void purgeExpiredTokens(AuthService auth) {
        try {
            auth.purgeExpiredRefreshTokens(PURGE_RETENTION);
        } catch (RuntimeException e) {
            log.warn("Purging expired refresh tokens failed", e);
        }
    }

    private static void setDefaultProperty(String name, String value) {
        if (System.getProperty(name) == null) {
            System.setProperty(name, value);
        }
    }
}
