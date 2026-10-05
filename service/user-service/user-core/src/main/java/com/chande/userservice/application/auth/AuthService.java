package com.chande.userservice.application.auth;

import com.chande.userservice.application.port.AccessTokenIssuer;
import com.chande.userservice.application.port.IdGenerator;
import com.chande.userservice.application.port.PasswordHasher;
import com.chande.userservice.application.port.RefreshTokenFactory;
import com.chande.userservice.application.port.RefreshTokenRepository;
import com.chande.userservice.application.port.TransactionRunner;
import com.chande.userservice.application.port.UserRepository;
import com.chande.userservice.domain.common.DomainException;
import com.chande.userservice.domain.common.ErrorCode;
import com.chande.userservice.domain.session.RefreshToken;
import com.chande.userservice.domain.user.PhoneNumber;
import com.chande.userservice.domain.user.User;

import java.lang.System.Logger;
import java.lang.System.Logger.Level;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/** Tài khoản và phiên: A1–A5 và P3. */
public final class AuthService {

    private static final Logger log = System.getLogger(AuthService.class.getName());

    private final UserRepository users;
    private final RefreshTokenRepository refreshTokens;
    private final PasswordHasher hasher;
    private final AccessTokenIssuer accessTokens;
    private final RefreshTokenFactory refreshTokenFactory;
    private final IdGenerator ids;
    private final TransactionRunner tx;
    private final Clock clock;
    private final Duration refreshTtl;

    /**
     * BR-07: hash giả để so khi SĐT không tồn tại. Tạo một lần, cùng cost với hash thật, nên đăng nhập bằng
     * SĐT lạ tốn thời gian y như sai mật khẩu: kẻ dò không đo được SĐT nào đã đăng ký.
     */
    private final String dummyHash;

    public AuthService(UserRepository users, RefreshTokenRepository refreshTokens, PasswordHasher hasher,
                       AccessTokenIssuer accessTokens, RefreshTokenFactory refreshTokenFactory, IdGenerator ids,
                       TransactionRunner tx, Clock clock, Duration refreshTtl) {
        this.users = Objects.requireNonNull(users);
        this.refreshTokens = Objects.requireNonNull(refreshTokens);
        this.hasher = Objects.requireNonNull(hasher);
        this.accessTokens = Objects.requireNonNull(accessTokens);
        this.refreshTokenFactory = Objects.requireNonNull(refreshTokenFactory);
        this.ids = Objects.requireNonNull(ids);
        this.tx = Objects.requireNonNull(tx);
        this.clock = Objects.requireNonNull(clock);
        this.refreshTtl = Objects.requireNonNull(refreshTtl);
        this.dummyHash = hasher.hash(UUID.randomUUID().toString());
    }

    /** A1. Kiểm trùng và BCrypt chạy ngoài transaction; transaction chỉ có INSERT. */
    public RegisteredUser register(RegisterCommand cmd) {
        PhoneNumber phone = PhoneNumber.parse(cmd.phoneNumber());
        if (users.existsByPhone(phone)) {
            throw new DomainException(ErrorCode.PHONE_ALREADY_EXISTS);
        }
        String passwordHash = hasher.hash(cmd.password());
        User user = User.register(ids.newId(), phone, passwordHash, cmd.fullName(), now());
        tx.inTransaction(() -> {
            users.insert(user);
            return null;
        });
        log.log(Level.INFO, () -> "User registered: " + user.id());
        return new RegisteredUser(user.id(), user.phone().value(), user.fullName(), user.createdAt());
    }

    /** A2. */
    public TokenPair login(LoginCommand cmd) {
        PhoneNumber phone = PhoneNumber.parse(cmd.phoneNumber());
        Optional<User> found = users.findByPhone(phone);
        if (found.isEmpty()) {
            hasher.matches(cmd.password(), dummyHash);
            throw new DomainException(ErrorCode.INVALID_CREDENTIALS);
        }
        User user = found.get();
        if (!hasher.matches(cmd.password(), user.passwordHash())) {
            throw new DomainException(ErrorCode.INVALID_CREDENTIALS);
        }
        if (user.isBlocked()) {
            throw new DomainException(ErrorCode.USER_BLOCKED);
        }
        Instant now = now();
        return tx.inTransaction(() -> issueTokens(user.id(), now));
    }

    /**
     * A3. Một transaction, khoá dòng token. Thứ tự kiểm: tồn tại -> đã xoay vòng -> hết hạn -> bị khoá.
     * Nhánh "dùng lại token" và "user bị khoá" phải commit thao tác xoá rồi mới báo lỗi, nên lỗi được trả về
     * dưới dạng {@link RefreshOutcome.Rejected} và chỉ ném ra sau khi transaction đã commit.
     */
    public TokenPair refresh(RefreshCommand cmd) {
        String hash = refreshTokenFactory.hash(cmd.refreshToken());
        RefreshOutcome outcome = tx.inTransaction(() -> {
            RefreshToken current = refreshTokens.findByHashForUpdate(hash).orElse(null);
            if (current == null) {
                return new RefreshOutcome.Rejected(ErrorCode.INVALID_REFRESH_TOKEN);
            }
            Instant now = now();
            if (current.isRevoked()) {
                // BR-13: token đã xoay vòng mà còn được dùng -> nhiều khả năng bị trộm, đăng xuất mọi thiết bị
                int deleted = refreshTokens.deleteAllByUserId(current.userId());
                log.log(Level.WARNING, () -> "Refresh token reuse detected for user " + current.userId()
                        + ", deleted " + deleted + " tokens");
                return new RefreshOutcome.Rejected(ErrorCode.INVALID_REFRESH_TOKEN);
            }
            if (current.isExpired(now)) {
                return new RefreshOutcome.Rejected(ErrorCode.INVALID_REFRESH_TOKEN);
            }
            Optional<User> user = users.findById(current.userId());
            if (user.isEmpty()) {
                return new RefreshOutcome.Rejected(ErrorCode.INVALID_REFRESH_TOKEN);
            }
            if (user.get().isBlocked()) {
                // Xoá chứ không chỉ đánh dấu: nếu không, lần refresh sau bằng chính token này bị báo nhầm là dùng lại
                int deleted = refreshTokens.deleteAllByUserId(current.userId());
                log.log(Level.INFO, () -> "Blocked user " + current.userId() + " tried to refresh, deleted "
                        + deleted + " tokens");
                return new RefreshOutcome.Rejected(ErrorCode.USER_BLOCKED);
            }
            current.revoke(now);
            refreshTokens.markRevoked(current.id(), now);
            return new RefreshOutcome.Issued(issueTokens(current.userId(), now));
        });
        return switch (outcome) {
            case RefreshOutcome.Issued issued -> issued.pair();
            case RefreshOutcome.Rejected rejected -> throw new DomainException(rejected.code());
        };
    }

    /** A4. Ai giữ refresh token thì thu hồi được token đó; không tiết lộ token có tồn tại hay không. */
    public void logout(RefreshCommand cmd) {
        refreshTokens.deleteByHash(refreshTokenFactory.hash(cmd.refreshToken()));
    }

    /** A5. Không kiểm user tồn tại. Access token đã cấp vẫn sống tới hạn. */
    public void logoutAll(UUID userId) {
        int deleted = refreshTokens.deleteAllByUserId(userId);
        log.log(Level.INFO, () -> "User " + userId + " logged out from all devices, deleted " + deleted + " tokens");
    }

    /**
     * P3. BCrypt chạy ngoài transaction; transaction chỉ gồm UPDATE có điều kiện (so-sánh-rồi-ghi trên hash vừa đọc)
     * và xoá mọi refresh token (Q4: không cấp token mới, app phải đăng nhập lại).
     */
    public void changePassword(UUID userId, ChangePasswordCommand cmd) {
        User user = users.findById(userId).orElseThrow(() -> new DomainException(ErrorCode.USER_NOT_FOUND));
        if (!hasher.matches(cmd.oldPassword(), user.passwordHash())) {
            throw new DomainException(ErrorCode.WRONG_OLD_PASSWORD);
        }
        if (cmd.newPassword().equals(cmd.oldPassword())) {
            throw new DomainException(ErrorCode.NEW_PASSWORD_SAME_AS_OLD);
        }
        String oldHash = user.passwordHash();
        user.changePasswordHash(hasher.hash(cmd.newPassword()), now());
        int deleted = tx.inTransaction(() -> {
            if (!users.updatePasswordHash(userId, oldHash, user.passwordHash(), user.updatedAt())) {
                throw new DomainException(ErrorCode.DATA_CONFLICT);
            }
            return refreshTokens.deleteAllByUserId(userId);
        });
        log.log(Level.INFO, () -> "User " + userId + " changed password, deleted " + deleted + " refresh tokens");
    }

    /**
     * Dọn refresh token đã hết hạn quá {@code retention}. Token hết hạn thì refresh đằng nào cũng bị từ chối,
     * nên giữ thêm một khoảng ngắn chỉ để còn phát hiện dùng lại ngay sau khi hết hạn.
     */
    public int purgeExpiredRefreshTokens(Duration retention) {
        int deleted = refreshTokens.deleteExpiredBefore(now().minus(retention));
        if (deleted > 0) {
            log.log(Level.INFO, () -> "Purged " + deleted + " expired refresh tokens");
        }
        return deleted;
    }

    /** BR-10: refresh token 32 byte ngẫu nhiên (DB chỉ giữ SHA-256), access JWT RS256. */
    private TokenPair issueTokens(UUID userId, Instant now) {
        RefreshTokenFactory.NewRefreshToken refresh = refreshTokenFactory.generate();
        refreshTokens.insert(RefreshToken.issue(ids.newId(), userId, refresh.hash(), now.plus(refreshTtl), now));
        AccessTokenIssuer.AccessToken access = accessTokens.issue(userId, now);
        return new TokenPair(access.value(), refresh.raw(), access.expiresInSeconds());
    }

    /** Cắt về micro giây để giá trị trả về khớp với giá trị PostgreSQL lưu. */
    private Instant now() {
        return clock.instant().truncatedTo(ChronoUnit.MICROS);
    }

    private sealed interface RefreshOutcome {

        record Issued(TokenPair pair) implements RefreshOutcome {
        }

        record Rejected(ErrorCode code) implements RefreshOutcome {
        }
    }
}
