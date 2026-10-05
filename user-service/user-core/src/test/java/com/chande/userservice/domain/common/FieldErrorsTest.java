package com.chande.userservice.domain.common;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

class FieldErrorsTest {

    @Test
    void keepsOnlyFirstErrorPerFieldInCheckOrder() {
        ValidationException e = catchThrowableOfType(ValidationException.class, () -> new FieldErrors()
                .required("password", "", "required")
                .length("password", "", 8, 72, "length")
                .matches("password", "", Pattern.compile(".+"), "pattern")
                .throwIfAny());

        assertThat(e.code()).isEqualTo(ErrorCode.VALIDATION_ERROR);
        assertThat(e.fieldErrors()).containsExactly(org.assertj.core.api.Assertions.entry("password", "required"));
    }

    @Test
    void preservesFieldOrder() {
        ValidationException e = catchThrowableOfType(ValidationException.class, () -> new FieldErrors()
                .required("b", null, "b")
                .required("a", null, "a")
                .throwIfAny());

        assertThat(e.fieldErrors().keySet()).containsExactly("b", "a");
    }

    @Test
    void requiredTreatsWhitespaceAsBlankLikeTrim() {
        assertThat(errorsOf(new FieldErrors().required("f", " \t\n", "m"))).isTrue();
        assertThat(errorsOf(new FieldErrors().required("f", " x ", "m"))).isFalse();
        // trim() chỉ cắt ký tự <= U+0020: khoảng trắng không ngắt (U+00A0) được coi là có nội dung
        assertThat(errorsOf(new FieldErrors().required("f", " ", "m"))).isFalse();
    }

    @Test
    void lengthCountsOriginalValueNotTrimmed() {
        assertThat(errorsOf(new FieldErrors().maxLength("f", " abc ", 4, "m"))).isTrue();
        assertThat(errorsOf(new FieldErrors().maxLength("f", "abcd", 4, "m"))).isFalse();
    }

    @Test
    void nullSkipsEverythingButRequired() {
        assertThatCode(() -> new FieldErrors()
                .maxLength("f", null, 1, "m")
                .length("f", null, 1, 2, "m")
                .maxUtf8Bytes("f", null, 1, "m")
                .matches("f", null, Pattern.compile("x"), "m")
                .between("f", null, BigDecimal.ZERO, BigDecimal.ONE, "m")
                .throwIfAny()).doesNotThrowAnyException();
    }

    @Test
    void maxUtf8BytesCountsMultiByteCharacters() {
        String vietnamese = "ệ".repeat(25); // 25 ký tự, 75 byte
        assertThat(errorsOf(new FieldErrors().maxUtf8Bytes("f", vietnamese, 72, "m"))).isTrue();
        assertThat(errorsOf(new FieldErrors().maxUtf8Bytes("f", "a".repeat(72), 72, "m"))).isFalse();
    }

    @Test
    void betweenIsInclusive() {
        BigDecimal min = BigDecimal.valueOf(-90);
        BigDecimal max = BigDecimal.valueOf(90);
        assertThat(errorsOf(new FieldErrors().between("f", new BigDecimal("90.00000000"), min, max, "m"))).isFalse();
        assertThat(errorsOf(new FieldErrors().between("f", new BigDecimal("-90"), min, max, "m"))).isFalse();
        assertThat(errorsOf(new FieldErrors().between("f", new BigDecimal("90.000000001"), min, max, "m"))).isTrue();
    }

    private static boolean errorsOf(FieldErrors errors) {
        try {
            errors.throwIfAny();
            return false;
        } catch (ValidationException e) {
            return true;
        }
    }
}
