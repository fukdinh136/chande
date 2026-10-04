package com.chande.user_service.user;

import com.chande.user_service.common.exception.ApiException;
import com.chande.user_service.common.exception.ErrorCode;
import com.chande.user_service.user.dto.InternalUserResponse;
import com.chande.user_service.user.dto.UpdateProfileRequest;
import com.chande.user_service.user.dto.UserProfileResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
@RequiredArgsConstructor
public class UserService {

    private final UserRepository userRepository;

    @Transactional(readOnly = true)
    public UserProfileResponse getProfile(UUID userId) {
        return UserProfileResponse.from(findUser(userId));
    }

    @Transactional
    public UserProfileResponse updateProfile(UUID userId, UpdateProfileRequest request) {
        User user = findUser(userId);

        if (request.fullName() != null) {
            user.setFullName(request.fullName().trim());
        }
        if (request.avatarUrl() != null) {
            user.setAvatarUrl(request.avatarUrl().trim());
        }

        return UserProfileResponse.from(user);
    }
    @Transactional(readOnly = true)
    public InternalUserResponse getInternalUser(UUID userId) {
        return InternalUserResponse.from(findUser(userId));
    }

    private User findUser(UUID userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new ApiException(ErrorCode.USER_NOT_FOUND));
    }
}