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

class RegisterRequestTest {

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

    // Trả về tên các ô bị lỗi, ví dụ {"password"}
    private Set<String> invalidFields(RegisterRequest request) {
        return validator.validate(request).stream()
                .map(v -> v.getPropertyPath().toString())
                .collect(Collectors.toSet());
    }

    @Test
    void validRequest_hasNoErrors() {
        assertTrue(invalidFields(new RegisterRequest("0912345678", "matkhau123", "Nguyễn Văn A")).isEmpty());
    }

    @Test
    void blankPhone_isRejected() {
        assertEquals(Set.of("phoneNumber"), invalidFields(new RegisterRequest("   ", "matkhau123", "Nguyễn Văn A")));
    }

    @Test
    void shortPassword_isRejected() {
        assertEquals(Set.of("password"), invalidFields(new RegisterRequest("0912345678", "abc12", "Nguyễn Văn A")));
    }

    @Test
    void passwordWithoutDigit_isRejected() {
        assertEquals(Set.of("password"), invalidFields(new RegisterRequest("0912345678", "matkhaudai", "Nguyễn Văn A")));
    }

    @Test
    void blankFullName_isRejected() {
        assertEquals(Set.of("fullName"), invalidFields(new RegisterRequest("0912345678", "matkhau123", "")));
    }

    @Test
    void tooLongFullName_isRejected() {
        assertEquals(Set.of("fullName"), invalidFields(new RegisterRequest("0912345678", "matkhau123", "a".repeat(101))));
    }
}