package com.chande.user_service.address.dto;

import jakarta.validation.Validation;
import jakarta.validation.Validator;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

class AddressRequestTest {

    private static Validator validator;

    @BeforeAll
    static void setUp() {
        validator = Validation.buildDefaultValidatorFactory().getValidator();
    }

    private Set<String> invalidFields(AddressRequest req) {
        return validator.validate(req).stream()
                .map(v -> v.getPropertyPath().toString())
                .collect(Collectors.toSet());
    }

    @Test
    void validHanoiAddress_withOptionalFieldsOmitted_passes() {
        AddressRequest req = new AddressRequest(null, "144 Xuân Thủy, Cầu Giấy",
                new BigDecimal("21.0368"), new BigDecimal("105.7820"), null);

        assertThat(invalidFields(req)).isEmpty();
    }

    @Test
    void boundaryCoordinates_pass() {
        AddressRequest req = new AddressRequest("Cực", "Điểm biên",
                new BigDecimal("-90"), new BigDecimal("180"), true);

        assertThat(invalidFields(req)).isEmpty();
    }

    @Test
    void outOfRangeCoordinates_fail() {
        AddressRequest req = new AddressRequest("Nhà", "Sai tọa độ",
                new BigDecimal("91"), new BigDecimal("-181"), null);

        assertThat(invalidFields(req)).containsExactlyInAnyOrder("lat", "lng");
    }

    @Test
    void missingCoordinates_fail() {
        AddressRequest req = new AddressRequest("Nhà", "Thiếu tọa độ", null, null, null);

        assertThat(invalidFields(req)).containsExactlyInAnyOrder("lat", "lng");
    }

    @Test
    void blankAddressText_fails() {
        AddressRequest req = new AddressRequest("Nhà", "   ",
                new BigDecimal("21.0368"), new BigDecimal("105.7820"), null);

        assertThat(invalidFields(req)).containsExactly("addressText");
    }
}