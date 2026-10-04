package com.chande.user_service.user;

import com.chande.user_service.auth.AuthService;
import com.chande.user_service.auth.dto.ChangePasswordRequest;
import com.chande.user_service.auth.dto.TokenResponse;
import com.chande.user_service.common.security.CurrentUser;
import com.chande.user_service.user.dto.UpdateProfileRequest;
import com.chande.user_service.user.dto.UserProfileResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

@RestController
@RequestMapping("/api/v1/users/me")
@RequiredArgsConstructor
public class UserController {

    private final UserService userService;
    private final AuthService authService;

    @GetMapping
    public UserProfileResponse getProfile(@AuthenticationPrincipal Jwt jwt) {
        return userService.getProfile(CurrentUser.id(jwt));
    }

    @PatchMapping
    public UserProfileResponse updateProfile(@AuthenticationPrincipal Jwt jwt,
                                             @Valid @RequestBody UpdateProfileRequest request) {
        return userService.updateProfile(CurrentUser.id(jwt), request);
    }


    @PostMapping("/password")
    public TokenResponse changePassword(@AuthenticationPrincipal Jwt jwt,
                                        @Valid @RequestBody ChangePasswordRequest request) {
        return authService.changePassword(CurrentUser.id(jwt), request);
    }
}
