package com.chande.userservice.domain.user;

import com.chande.userservice.domain.common.DomainException;
import com.chande.userservice.domain.common.ErrorCode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PhoneNumberTest {

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "0912345678     | +84912345678",
            "84912345678    | +84912345678",
            "+84912345678   | +84912345678",
            "091 234 5678   | +84912345678",
            "091.234.5678   | +84912345678",
            "091-234-5678   | +84912345678",
            "(091) 234-5678 | +84912345678",
            "0387654321     | +84387654321",
            "0512345678     | +84512345678",
            "0712345678     | +84712345678",
            "0812345678     | +84812345678",
    })
    void normalizesValidVietnameseMobileNumbers(String raw, String expected) {
        assertThat(PhoneNumber.parse(raw).value()).isEqualTo(expected);
    }

    @Test
    void stripsTabsAndNewlinesToo() {
        assertThat(PhoneNumber.parse("\t0912\n345678 ").value()).isEqualTo("+84912345678");
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "0123456789",   // đầu số 01x đã bỏ
            "091234567",    // thiếu 1 số
            "09123456789",  // thừa 1 số
            "912345678",    // không có đầu 0/84/+84
            "+1912345678",
            "0612345678",   // 06 không phải đầu số di động
            "0412345678",
            "091234567a",
            "+84 91234567８", // chữ số full-width
            "",
            "   ",
    })
    void rejectsInvalidNumbers(String raw) {
        assertThatThrownBy(() -> PhoneNumber.parse(raw))
                .isInstanceOf(DomainException.class)
                .extracting(e -> ((DomainException) e).code())
                .isEqualTo(ErrorCode.INVALID_PHONE_NUMBER);
    }

    @Test
    void rejectsNull() {
        assertThatThrownBy(() -> PhoneNumber.parse(null)).isInstanceOf(DomainException.class);
    }
}
