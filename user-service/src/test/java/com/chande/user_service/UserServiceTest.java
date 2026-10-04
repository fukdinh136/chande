package com.chande.user_service;

import com.chande.user_service.common.exception.ApiException;
import com.chande.user_service.common.exception.ErrorCode;
import com.chande.user_service.user.User;
import com.chande.user_service.user.UserRepository;
import com.chande.user_service.user.UserService;
import com.chande.user_service.user.UserStatus;
import com.chande.user_service.user.dto.InternalUserResponse;
import com.chande.user_service.user.dto.UpdateProfileRequest;
import com.chande.user_service.user.dto.UserProfileResponse;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.AssertionsForClassTypes.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class UserServiceTest {

    @Mock
    private UserRepository userRepository;

    @InjectMocks
    private UserService userService;

    private User existingUser() {
        User u = new User();
        u.setId(UUID.randomUUID());
        u.setPhoneNumber("+84912345678");
        u.setFullName("Nguyen Van A");
        u.setAvatarUrl("https://cdn.example.com/old.png");
        return u;
    }

    @Test
    void getProfile_existingUser_returnsProfile() {
        User user = existingUser();
        when(userRepository.findById(user.getId())).thenReturn(Optional.of(user));

        UserProfileResponse res = userService.getProfile(user.getId());

        assertThat(res.id()).isEqualTo(user.getId());
        assertThat(res.fullName()).isEqualTo("Nguyen Van A");
    }

    @Test
    void getProfile_missingUser_throwsNotFound() {
        when(userRepository.findById(any())).thenReturn(Optional.empty());

        ApiException ex = assertThrows(ApiException.class, () -> userService.getProfile(UUID.randomUUID()));

        assertThat(ex.getErrorCode()).isEqualTo(ErrorCode.USER_NOT_FOUND);
    }

    @Test
    void updateProfile_onlyFullName_keepsAvatar() {
        User user = existingUser();
        when(userRepository.findById(user.getId())).thenReturn(Optional.of(user));

        UserProfileResponse res = userService.updateProfile(user.getId(),
                new UpdateProfileRequest("  Tran Thi B  ", null));

        assertThat(res.fullName()).isEqualTo("Tran Thi B");
        assertThat(res.avatarUrl()).isEqualTo("https://cdn.example.com/old.png");
    }

    @Test
    void updateProfile_emptyRequest_changesNothing() {
        User user = existingUser();
        when(userRepository.findById(user.getId())).thenReturn(Optional.of(user));

        userService.updateProfile(user.getId(), new UpdateProfileRequest(null, null));

        assertThat(user.getFullName()).isEqualTo("Nguyen Van A");
        assertThat(user.getAvatarUrl()).isEqualTo("https://cdn.example.com/old.png");
        verify(userRepository, never()).save(any());
    }

    @Test
    void getInternalUser_existingUser_returnsContactAndStatus() {
        User user = existingUser();
        user.setStatus(UserStatus.BLOCKED);
        when(userRepository.findById(user.getId())).thenReturn(Optional.of(user));

        InternalUserResponse res = userService.getInternalUser(user.getId());

        assertThat(res.id()).isEqualTo(user.getId());
        assertThat(res.fullName()).isEqualTo("Nguyen Van A");
        assertThat(res.phoneNumber()).isEqualTo("+84912345678");
        assertThat(res.status()).isEqualTo(UserStatus.BLOCKED);
    }

    @Test
    void getInternalUser_missingUser_throwsNotFound() {
        when(userRepository.findById(any())).thenReturn(Optional.empty());

        ApiException ex = assertThrows(ApiException.class,
                () -> userService.getInternalUser(UUID.randomUUID()));

        assertThat(ex.getErrorCode()).isEqualTo(ErrorCode.USER_NOT_FOUND);
    }
}