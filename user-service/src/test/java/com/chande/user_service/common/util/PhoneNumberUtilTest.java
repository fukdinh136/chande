package com.chande.user_service.common.util;

import com.chande.user_service.common.exception.ApiException;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class PhoneNumberUtilTest {

    // Mỗi dòng: "đầu vào", "kết quả mong đợi"
    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "0912345678        | +84912345678",
            "84912345678       | +84912345678",
            "+84912345678      | +84912345678",
            "091 234 5678      | +84912345678",
            "091.234.5678      | +84912345678",
            "(+84) 912-345-678 | +84912345678",
            "0387654321        | +84387654321"
    })
    void normalize_validNumbers(String input, String expected) {
        assertEquals(expected, PhoneNumberUtil.normalize(input));
    }

    // Các số KHÔNG hợp lệ: phải ném ApiException
    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {
            "0123456789",    // đầu số 01x không còn dùng
            "091234567",     // thiếu 1 số
            "09123456789",   // thừa 1 số
            "abcdefghij",    // không phải số
            "+15551234567"   // số nước ngoài
    })
    void normalize_invalidNumbers(String input) {
        assertThrows(ApiException.class, () -> PhoneNumberUtil.normalize(input));
    }
}