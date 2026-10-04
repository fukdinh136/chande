package com.chande.user_service.auth.dto;

import com.chande.user_service.user.User;
import org.junit.jupiter.api.Test;

import java.lang.reflect.RecordComponent;
import java.time.OffsetDateTime;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;

class RegisterResponseTest {

    @Test
    void from_copiesFieldsFromUser() {
        User user = new User();
        UUID id = UUID.randomUUID();
        OffsetDateTime createdAt = OffsetDateTime.now();
        user.setId(id);
        user.setPhoneNumber("+84912345678");
        user.setFullName("Nguyễn Văn A");
        user.setPasswordHash("$2a$10$abcdefghijklmnopqrstuv");
        user.setCreatedAt(createdAt);

        RegisterResponse response = RegisterResponse.from(user);

        assertEquals(id, response.id());
        assertEquals("+84912345678", response.phoneNumber());
        assertEquals("Nguyễn Văn A", response.fullName());
        assertEquals(createdAt, response.createdAt());
    }

    // Đảm bảo DTO KHÔNG có field nào liên quan tới mật khẩu
    @Test
    void response_hasOnlyPublicFields() {
        List<String> names = Arrays.stream(RegisterResponse.class.getRecordComponents())
                .map(RecordComponent::getName)
                .toList();

        assertEquals(List.of("id", "phoneNumber", "fullName", "createdAt"), names);
    }
}