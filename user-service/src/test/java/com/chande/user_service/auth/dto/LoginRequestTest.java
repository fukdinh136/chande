package com.chande.user_service.auth.dto;

import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class LoginRequestTest {

    private static ValidatorFactory factory;
    private static Validator validator;

    @BeforeAll
    static void setUp() {
        factory = Validation.buildDefaultValidatorFactory();
        validator = factory.getValidator();
    }

    @AfterAll
    static void tearDown() {
        factory.close();
    }

    private Set<String> invalidFields(LoginRequest request) {
        return validator.validate(request).stream()
                .map(v -> v.getPropertyPath().toString())
                .collect(Collectors.toSet());
    }

    @Test
    void validRequest_hasNoErrors() {
        assertTrue(invalidFields(new LoginRequest("0912345678", "matkhau123")).isEmpty());
    }

    // Quan trọng: mật khẩu ngắn/yếu VẪN được gửi đi, để service so khớp và trả INVALID_CREDENTIALS
    @Test
    void shortPassword_isAccepted() {
        assertTrue(invalidFields(new LoginRequest("0912345678", "abc")).isEmpty());
    }

    @Test
    void blankPhone_isRejected() {
        assertEquals(Set.of("phoneNumber"), invalidFields(new LoginRequest("", "matkhau123")));
    }

    @Test
    void nullPassword_isRejected() {
        assertEquals(Set.of("password"), invalidFields(new LoginRequest("0912345678", null)));
    }

    @Test
    void tooLongPassword_isRejected() {
        assertEquals(Set.of("password"), invalidFields(new LoginRequest("0912345678", "a".repeat(73))));
    }
}