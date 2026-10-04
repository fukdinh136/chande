package com.chande.user_service.auth;

import com.chande.user_service.auth.dto.*;
import com.chande.user_service.common.exception.ApiException;
import com.chande.user_service.common.exception.ErrorCode;
import com.chande.user_service.jwt.JwtProperties;
import com.chande.user_service.jwt.JwtService;
import com.chande.user_service.user.User;
import com.chande.user_service.user.UserRepository;
import com.chande.user_service.user.UserStatus;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.eq;


@ExtendWith(MockitoExtension.class)
class AuthServiceTest {

    @Mock UserRepository userRepository;       // Repository giả
    @Mock PasswordEncoder passwordEncoder;
    @Mock RefreshTokenRepository refreshTokenRepository;
    @Mock JwtService jwtService;
    @Mock JwtProperties jwtProperties;// Bộ băm giả
    @InjectMocks AuthService authService;      // Service thật, được tiêm 2 mock ở trên
    private static final String RAW = "raw-refresh-token-for-test";

    private User userWithStatus(UserStatus status) {
        User u = new User();
        u.setId(UUID.randomUUID());
        u.setPhoneNumber("+84912345678");
        u.setStatus(status);
        return u;
    }

    private RefreshToken storedToken(User user, OffsetDateTime expiresAt, OffsetDateTime revokedAt) {
        RefreshToken t = new RefreshToken();
        t.setUser(user);
        t.setTokenHash(AuthService.sha256Hex(RAW));
        t.setExpiresAt(expiresAt);
        t.setRevokedAt(revokedAt);
        return t;
    }

    @Test
    void changePassword_success_updatesHashDeletesTokensAndIssuesNew() {
        User user = userWithStatus(UserStatus.ACTIVE);
        user.setPasswordHash("old-hash");
        when(userRepository.findById(user.getId())).thenReturn(Optional.of(user));
        when(passwordEncoder.matches("Matkhau123", "old-hash")).thenReturn(true);
        when(passwordEncoder.encode("Matkhau456")).thenReturn("new-hash");
        when(jwtService.createAccessToken(user)).thenReturn("new-access");
        when(jwtService.accessTokenTtlSeconds()).thenReturn(900L);
        when(jwtProperties.refreshTokenTtl()).thenReturn(Duration.ofDays(30));

        TokenResponse res = authService.changePassword(user.getId(),
                new ChangePasswordRequest("Matkhau123", "Matkhau456"));

        assertThat(user.getPasswordHash()).isEqualTo("new-hash");
        assertThat(res.accessToken()).isEqualTo("new-access");

        InOrder inOrder = inOrder(passwordEncoder, refreshTokenRepository);
        inOrder.verify(passwordEncoder).encode("Matkhau456");
        inOrder.verify(refreshTokenRepository).deleteAllByUserId(user.getId());
        inOrder.verify(refreshTokenRepository).save(any(RefreshToken.class));
    }

    @Test
    void changePassword_wrongOldPassword_throwsAndChangesNothing() {
        User user = userWithStatus(UserStatus.ACTIVE);
        user.setPasswordHash("old-hash");
        when(userRepository.findById(user.getId())).thenReturn(Optional.of(user));
        when(passwordEncoder.matches("SaiMatKhau1", "old-hash")).thenReturn(false);

        ApiException ex = assertThrows(ApiException.class, () -> authService.changePassword(user.getId(),
                new ChangePasswordRequest("SaiMatKhau1", "Matkhau456")));

        assertThat(ex.getErrorCode()).isEqualTo(ErrorCode.WRONG_OLD_PASSWORD);
        assertThat(user.getPasswordHash()).isEqualTo("old-hash");
        verify(refreshTokenRepository, never()).deleteAllByUserId(any());
    }

    @Test
    void changePassword_sameAsOld_throws() {
        User user = userWithStatus(UserStatus.ACTIVE);
        user.setPasswordHash("old-hash");
        when(userRepository.findById(user.getId())).thenReturn(Optional.of(user));
        when(passwordEncoder.matches("Matkhau123", "old-hash")).thenReturn(true);

        ApiException ex = assertThrows(ApiException.class, () -> authService.changePassword(user.getId(),
                new ChangePasswordRequest("Matkhau123", "Matkhau123")));

        assertThat(ex.getErrorCode()).isEqualTo(ErrorCode.NEW_PASSWORD_SAME_AS_OLD);
        verify(passwordEncoder, never()).encode(any());
    }

    @Test
    void changePassword_userNotFound_throws() {
        when(userRepository.findById(any())).thenReturn(Optional.empty());

        ApiException ex = assertThrows(ApiException.class, () -> authService.changePassword(UUID.randomUUID(),
                new ChangePasswordRequest("Matkhau123", "Matkhau456")));

        assertThat(ex.getErrorCode()).isEqualTo(ErrorCode.USER_NOT_FOUND);
        verifyNoInteractions(passwordEncoder);
    }

    @Test
    void logout_ownToken_revokesIt() {
        User user = userWithStatus(UserStatus.ACTIVE);
        RefreshToken token = storedToken(user, OffsetDateTime.now().plusDays(1), null);
        when(refreshTokenRepository.findByTokenHash(AuthService.sha256Hex(RAW))).thenReturn(Optional.of(token));

        authService.logout(user.getId(), RAW);

        verify(refreshTokenRepository).delete(token);
    }

    @Test
    void logout_tokenOfAnotherUser_doesNotRevoke() {
        User owner = userWithStatus(UserStatus.ACTIVE);
        RefreshToken token = storedToken(owner, OffsetDateTime.now().plusDays(1), null);
        when(refreshTokenRepository.findByTokenHash(any())).thenReturn(Optional.of(token));

        authService.logout(UUID.randomUUID(), RAW);

        verify(refreshTokenRepository, never()).delete(any());
    }

    @Test
    void logout_unknownToken_doesNotThrow() {
        when(refreshTokenRepository.findByTokenHash(any())).thenReturn(Optional.empty());

        assertDoesNotThrow(() -> authService.logout(UUID.randomUUID(), RAW));
    }

    @Test
    void logoutAll_revokesAllTokensOfUser() {
        UUID userId = UUID.randomUUID();

        authService.logoutAll(userId);

        verify(refreshTokenRepository).deleteAllByUserId(userId);
    }
    @Test
    void refresh_validToken_revokesOldAndIssuesNew() {
        User user = userWithStatus(UserStatus.ACTIVE);
        RefreshToken old = storedToken(user, OffsetDateTime.now().plusDays(1), null);
        when(refreshTokenRepository.findByTokenHashForUpdate(AuthService.sha256Hex(RAW))).thenReturn(Optional.of(old));
        when(jwtService.createAccessToken(user)).thenReturn("new-access");
        when(jwtService.accessTokenTtlSeconds()).thenReturn(900L);
        when(jwtProperties.refreshTokenTtl()).thenReturn(Duration.ofDays(30));

        TokenResponse res = authService.refresh(RAW);

        assertThat(old.isRevoked()).isTrue();
        assertThat(res.accessToken()).isEqualTo("new-access");
        assertThat(res.refreshToken()).isNotEqualTo(RAW).hasSize(43);

        ArgumentCaptor<RefreshToken> captor = ArgumentCaptor.forClass(RefreshToken.class);
        verify(refreshTokenRepository).save(captor.capture());
        assertThat(captor.getValue().getTokenHash()).isEqualTo(AuthService.sha256Hex(res.refreshToken()));
        verify(refreshTokenRepository, never()).deleteAllByUserId(any());
        // Refresh phải đọc token bằng truy vấn có khoá dòng, không dùng bản không khoá
        verify(refreshTokenRepository, never()).findByTokenHash(any());
    }

    @Test
    void refresh_reusedRevokedToken_revokesAllSessions() {
        User user = userWithStatus(UserStatus.ACTIVE);
        RefreshToken used = storedToken(user, OffsetDateTime.now().plusDays(1), OffsetDateTime.now().minusMinutes(5));
        when(refreshTokenRepository.findByTokenHashForUpdate(any())).thenReturn(Optional.of(used));

        ApiException ex = assertThrows(ApiException.class, () -> authService.refresh(RAW));

        assertThat(ex.getErrorCode()).isEqualTo(ErrorCode.INVALID_REFRESH_TOKEN);
        verify(refreshTokenRepository).deleteAllByUserId(user.getId());
        verify(jwtService, never()).createAccessToken(any());
    }

    @Test
    void refresh_expiredToken_throwsWithoutRevokingAll() {
        User user = userWithStatus(UserStatus.ACTIVE);
        RefreshToken expired = storedToken(user, OffsetDateTime.now().minusMinutes(1), null);
        when(refreshTokenRepository.findByTokenHashForUpdate(any())).thenReturn(Optional.of(expired));

        ApiException ex = assertThrows(ApiException.class, () -> authService.refresh(RAW));

        assertThat(ex.getErrorCode()).isEqualTo(ErrorCode.INVALID_REFRESH_TOKEN);
        verify(refreshTokenRepository, never()).deleteAllByUserId(any());
        verify(refreshTokenRepository, never()).save(any());
    }

    @Test
    void refresh_unknownToken_throws() {
        when(refreshTokenRepository.findByTokenHashForUpdate(any())).thenReturn(Optional.empty());

        ApiException ex = assertThrows(ApiException.class, () -> authService.refresh(RAW));

        assertThat(ex.getErrorCode()).isEqualTo(ErrorCode.INVALID_REFRESH_TOKEN);
        verifyNoInteractions(jwtService);
    }

    @Test
    void refresh_blockedUser_deletesAllSessionsAndThrows() {
        User user = userWithStatus(UserStatus.BLOCKED);
        RefreshToken token = storedToken(user, OffsetDateTime.now().plusDays(1), null);
        when(refreshTokenRepository.findByTokenHashForUpdate(any())).thenReturn(Optional.of(token));

        ApiException ex = assertThrows(ApiException.class, () -> authService.refresh(RAW));

        assertThat(ex.getErrorCode()).isEqualTo(ErrorCode.USER_BLOCKED);
        // Xoá hẳn (không chỉ đánh dấu xoay vòng) để lần refresh sau không bị ghi nhầm là dùng lại token
        verify(refreshTokenRepository).deleteAllByUserId(user.getId());
        assertThat(token.isRevoked()).isFalse();
        verifyNoInteractions(jwtService);
    }
    @Test
    void register_success_normalizesPhoneAndHashesPassword() {
        when(userRepository.existsByPhoneNumber("+84912345678")).thenReturn(false);
        when(passwordEncoder.encode("matkhau123")).thenReturn("HASHED");
        when(userRepository.saveAndFlush(any(User.class))).thenAnswer(inv -> {
            User u = inv.getArgument(0);
            u.setId(UUID.randomUUID());   // Giả lập DB sinh id
            return u;
        });

        RegisterResponse res = authService.register(
                new RegisterRequest("091 234 5678", "matkhau123", "  Nguyễn Văn A  "));

        // Bắt lấy User đã được đưa vào saveAndFlush để kiểm tra
        ArgumentCaptor<User> captor = ArgumentCaptor.forClass(User.class);
        verify(userRepository).saveAndFlush(captor.capture());
        User saved = captor.getValue();

        assertEquals("+84912345678", saved.getPhoneNumber());   // SĐT đã chuẩn hóa
        assertEquals("HASHED", saved.getPasswordHash());         // Lưu mã băm, KHÔNG lưu mật khẩu gốc
        assertEquals("Nguyễn Văn A", saved.getFullName());       // Đã trim
        assertNotNull(res.id());
        assertEquals("+84912345678", res.phoneNumber());
    }

    @Test
    void register_duplicatePhone_throwsConflict_withoutHashing() {
        when(userRepository.existsByPhoneNumber("+84912345678")).thenReturn(true);

        ApiException ex = assertThrows(ApiException.class, () -> authService.register(
                new RegisterRequest("0912345678", "matkhau123", "Nguyễn Văn A")));

        assertEquals(ErrorCode.PHONE_ALREADY_EXISTS, ex.getErrorCode());
        verify(userRepository, never()).saveAndFlush(any());
        verifyNoInteractions(passwordEncoder);   // Không tốn công băm khi đã trùng
    }

    @Test
    void register_invalidPhone_throwsBeforeTouchingDatabase() {
        ApiException ex = assertThrows(ApiException.class, () -> authService.register(
                new RegisterRequest("0123", "matkhau123", "Nguyễn Văn A")));

        assertEquals(ErrorCode.INVALID_PHONE_NUMBER, ex.getErrorCode());
        verifyNoInteractions(userRepository, passwordEncoder);
    }

    @Test
    void register_concurrentDuplicate_mapsDbErrorToConflict() {
        when(userRepository.existsByPhoneNumber(anyString())).thenReturn(false);
        when(passwordEncoder.encode(anyString())).thenReturn("HASHED");
        when(userRepository.saveAndFlush(any(User.class)))
                .thenThrow(new DataIntegrityViolationException("uk_users_phone_number"));

        ApiException ex = assertThrows(ApiException.class, () -> authService.register(
                new RegisterRequest("0912345678", "matkhau123", "Nguyễn Văn A")));

        assertEquals(ErrorCode.PHONE_ALREADY_EXISTS, ex.getErrorCode());
    }
    // ===================== LOGIN =====================

    private User activeUser() {
        User user = new User();
        user.setId(UUID.randomUUID());
        user.setPhoneNumber("+84912345678");
        user.setPasswordHash("HASHED");
        user.setFullName("Nguyễn Văn A");
        return user;   // status mặc định ACTIVE
    }

    @Test
    void login_success_returnsTokens_andStoresOnlyHashOfRefreshToken() {
        User user = activeUser();
        when(userRepository.findByPhoneNumber("+84912345678")).thenReturn(Optional.of(user));
        when(passwordEncoder.matches("matkhau123", "HASHED")).thenReturn(true);
        when(jwtService.createAccessToken(user)).thenReturn("ACCESS");
        when(jwtService.accessTokenTtlSeconds()).thenReturn(900L);
        when(jwtProperties.refreshTokenTtl()).thenReturn(Duration.ofDays(30));

        TokenResponse res = authService.login(new LoginRequest("091 234 5678", "matkhau123"));

        assertEquals("ACCESS", res.accessToken());
        assertEquals("Bearer", res.tokenType());
        assertEquals(900, res.expiresIn());
        assertEquals(43, res.refreshToken().length());   // 32 byte -> 43 ký tự base64url

        ArgumentCaptor<RefreshToken> captor = ArgumentCaptor.forClass(RefreshToken.class);
        verify(refreshTokenRepository).save(captor.capture());
        RefreshToken saved = captor.getValue();

        assertSame(user, saved.getUser());
        assertEquals(AuthService.sha256Hex(res.refreshToken()), saved.getTokenHash());
        assertNotEquals(res.refreshToken(), saved.getTokenHash());   // DB KHÔNG chứa bản gốc
        assertEquals(64, saved.getTokenHash().length());
        assertTrue(saved.getExpiresAt().isAfter(OffsetDateTime.now().plusDays(29)));
    }

    @Test
    void login_unknownPhone_throwsInvalidCredentials() {
        when(userRepository.findByPhoneNumber("+84912345678")).thenReturn(Optional.empty());

        ApiException ex = assertThrows(ApiException.class,
                () -> authService.login(new LoginRequest("0912345678", "matkhau123")));

        assertEquals(ErrorCode.INVALID_CREDENTIALS, ex.getErrorCode());
        // SĐT không tồn tại vẫn phải chạy BCrypt, để thời gian phản hồi không lộ SĐT nào đã đăng ký
        verify(passwordEncoder).matches(eq("matkhau123"), any());
        verifyNoInteractions(jwtService, refreshTokenRepository);
    }

    @Test
    void login_wrongPassword_throwsInvalidCredentials() {
        when(userRepository.findByPhoneNumber("+84912345678")).thenReturn(Optional.of(activeUser()));
        when(passwordEncoder.matches("saimatkhau1", "HASHED")).thenReturn(false);

        ApiException ex = assertThrows(ApiException.class,
                () -> authService.login(new LoginRequest("0912345678", "saimatkhau1")));

        assertEquals(ErrorCode.INVALID_CREDENTIALS, ex.getErrorCode());
        verifyNoInteractions(jwtService, refreshTokenRepository);
    }

    @Test
    void login_blockedUser_withCorrectPassword_throwsUserBlocked() {
        User user = activeUser();
        user.setStatus(UserStatus.BLOCKED);
        when(userRepository.findByPhoneNumber("+84912345678")).thenReturn(Optional.of(user));
        when(passwordEncoder.matches("matkhau123", "HASHED")).thenReturn(true);

        ApiException ex = assertThrows(ApiException.class,
                () -> authService.login(new LoginRequest("0912345678", "matkhau123")));

        assertEquals(ErrorCode.USER_BLOCKED, ex.getErrorCode());
        verifyNoInteractions(jwtService, refreshTokenRepository);
    }

    // Tài khoản bị khóa + SAI mật khẩu: không được tiết lộ là bị khóa
    @Test
    void login_blockedUser_withWrongPassword_throwsInvalidCredentials() {
        User user = activeUser();
        user.setStatus(UserStatus.BLOCKED);
        when(userRepository.findByPhoneNumber("+84912345678")).thenReturn(Optional.of(user));
        when(passwordEncoder.matches("saimatkhau1", "HASHED")).thenReturn(false);

        ApiException ex = assertThrows(ApiException.class,
                () -> authService.login(new LoginRequest("0912345678", "saimatkhau1")));

        assertEquals(ErrorCode.INVALID_CREDENTIALS, ex.getErrorCode());
    }

}