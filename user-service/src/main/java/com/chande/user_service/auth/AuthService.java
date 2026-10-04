package com.chande.user_service.auth;

import com.chande.user_service.auth.dto.*;
import com.chande.user_service.common.exception.ApiException;
import com.chande.user_service.common.exception.ErrorCode;
import com.chande.user_service.common.util.PhoneNumberUtil;
import com.chande.user_service.jwt.JwtProperties;
import com.chande.user_service.jwt.JwtService;
import com.chande.user_service.user.User;
import com.chande.user_service.user.UserRepository;

import com.chande.user_service.user.UserStatus;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.HexFormat;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
public class AuthService {
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final RefreshTokenRepository refreshTokenRepository;
    private final JwtService jwtService;
    private final JwtProperties jwtProperties;
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    // Mã băm giả để so khi SĐT không tồn tại: vẫn tốn thời gian chạy BCrypt như khi sai mật khẩu,
    // nên không đo được độ trễ để biết SĐT nào đã đăng ký
    private String dummyPasswordHash;

    @PostConstruct
    void initDummyPasswordHash() {
        dummyPasswordHash = passwordEncoder.encode(UUID.randomUUID().toString());
    }

    @Transactional
    public RegisterResponse register(RegisterRequest request){
        String phone = PhoneNumberUtil.normalize(request.phoneNumber());

        if(userRepository.existsByPhoneNumber(phone)){
            throw new ApiException(ErrorCode.PHONE_ALREADY_EXISTS);
        }
        User user = new User();
        user.setPhoneNumber(phone);
        user.setPasswordHash(passwordEncoder.encode(request.password()));
        user.setFullName(request.fullName().trim());

        User saved;
        try {
            saved = userRepository.saveAndFlush(user);
        } catch (DataIntegrityViolationException e) {
            throw new ApiException(ErrorCode.PHONE_ALREADY_EXISTS);
        }
        log.info("User registered: {}", saved.getId());
        return RegisterResponse.from(saved);
    }

    private TokenResponse issueTokens(User user){
        String accessToken = jwtService.createAccessToken(user);
        String rawRefreshToken = generateRefreshToken();
        RefreshToken rt = new RefreshToken();
        rt.setUser(user);
        rt.setTokenHash(sha256Hex(rawRefreshToken));
        rt.setExpiresAt(OffsetDateTime.now().plus(jwtProperties.refreshTokenTtl()));
        refreshTokenRepository.save(rt);
        return TokenResponse.of(accessToken, rawRefreshToken, jwtService.accessTokenTtlSeconds());
    }


    static String sha256Hex(String value) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }

    private static String generateRefreshToken(){
        byte[] bytes = new byte[32];
        SECURE_RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    @Transactional
    public TokenResponse login(LoginRequest request){
        String phone = PhoneNumberUtil.normalize(request.phoneNumber());
        User user = userRepository.findByPhoneNumber(phone).orElse(null);
        if (user == null) {
            passwordEncoder.matches(request.password(), dummyPasswordHash);
            throw new ApiException(ErrorCode.INVALID_CREDENTIALS);
        }
        if (!passwordEncoder.matches(request.password(), user.getPasswordHash()))
            throw new  ApiException(ErrorCode.INVALID_CREDENTIALS);
        if (user.getStatus() == UserStatus.BLOCKED)
            throw new  ApiException(ErrorCode.USER_BLOCKED);

        return issueTokens(user);
    }

    @Transactional(noRollbackFor = ApiException.class)
    public TokenResponse refresh(String rawRefreshToken){
        // Khoá dòng token: refresh đồng thời bằng cùng token không thể cùng thành công
        RefreshToken current = refreshTokenRepository.findByTokenHashForUpdate(sha256Hex(rawRefreshToken)).orElseThrow(() -> new ApiException(ErrorCode.INVALID_REFRESH_TOKEN));
        OffsetDateTime now = OffsetDateTime.now();

        User user = current.getUser();

        if (current.isRevoked()) {
            int deleted = refreshTokenRepository.deleteAllByUserId(user.getId());
            log.warn("Refresh token reuse detected for user {}, deleted {} tokens", user.getId(), deleted);
            throw new ApiException(ErrorCode.INVALID_REFRESH_TOKEN);
        }

        if(current.isExpired(now)){
            throw new ApiException(ErrorCode.INVALID_REFRESH_TOKEN);
        }

        if (user.getStatus() == UserStatus.BLOCKED) {
            // Xoá hết phiên của tài khoản bị khoá. Nếu chỉ đánh dấu xoay vòng, lần refresh sau
            // bằng token này bị ghi nhầm là "phát hiện dùng lại token" (cảnh báo trộm token sai).
            int deleted = refreshTokenRepository.deleteAllByUserId(user.getId());
            log.info("Blocked user {} tried to refresh, deleted {} tokens", user.getId(), deleted);
            throw new ApiException(ErrorCode.USER_BLOCKED);
        }
        current.revoke(now);
        return issueTokens(user);
    }

    @Transactional
    public void logout(UUID userId, String rawRefreshToken) {
        refreshTokenRepository.findByTokenHash(sha256Hex(rawRefreshToken))
                .filter(token -> token.getUser().getId().equals(userId))
                .ifPresent(refreshTokenRepository::delete);
    }

    @Transactional
    public void logoutAll(UUID userId) {
        int deleted = refreshTokenRepository.deleteAllByUserId(userId);
        log.info("User {} logged out from all devices, deleted {} tokens", userId, deleted);
    }

    @Transactional
    public TokenResponse changePassword(UUID userId, ChangePasswordRequest request) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ApiException(ErrorCode.USER_NOT_FOUND));

        if (!passwordEncoder.matches(request.oldPassword(), user.getPasswordHash())) {
            throw new ApiException(ErrorCode.WRONG_OLD_PASSWORD);
        }
        if (request.newPassword().equals(request.oldPassword())) {
            throw new ApiException(ErrorCode.NEW_PASSWORD_SAME_AS_OLD);
        }

        user.setPasswordHash(passwordEncoder.encode(request.newPassword()));
        int deleted = refreshTokenRepository.deleteAllByUserId(userId);
        log.info("User {} changed password, deleted {} refresh tokens", userId, deleted);

        return issueTokens(user);
    }
}
