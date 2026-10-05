package com.chande.userservice.domain.address;

import com.chande.userservice.domain.common.DomainException;
import com.chande.userservice.domain.common.ErrorCode;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AddressTest {

    private static final Instant NOW = Instant.parse("2026-10-06T00:00:00Z");

    @Test
    void createNormalizesFields() {
        Address a = Address.create(UUID.randomUUID(), UUID.randomUUID(), "  Nhà  ", "  Keangnam  ",
                new BigDecimal("21.017"), new BigDecimal("105.784000005"), true, NOW);

        assertThat(a.label()).isEqualTo("Nhà");
        assertThat(a.addressText()).isEqualTo("Keangnam");
        assertThat(a.lat()).isEqualTo(new BigDecimal("21.01700000"));
        assertThat(a.lng()).isEqualTo(new BigDecimal("105.78400001")); // HALF_UP
        assertThat(a.isDefault()).isTrue();
    }

    @Test
    void blankLabelIsStoredAsNull() {
        Address a = Address.create(UUID.randomUUID(), UUID.randomUUID(), "   ", "x", BigDecimal.ONE, BigDecimal.ONE,
                false, NOW);
        assertThat(a.label()).isNull();

        a.replaceDetails(null, "y", BigDecimal.ZERO, BigDecimal.ZERO);
        assertThat(a.label()).isNull();
        assertThat(a.lat().toPlainString()).isEqualTo("0.00000000");
    }

    @Test
    void replaceDetailsKeepsDefaultFlag() {
        Address a = Address.create(UUID.randomUUID(), UUID.randomUUID(), "A", "x", BigDecimal.ONE, BigDecimal.ONE,
                true, NOW);
        a.replaceDetails("B", "y", BigDecimal.TEN, BigDecimal.TEN);
        assertThat(a.isDefault()).isTrue();
    }

    @Test
    void limitIsTenAddresses() {
        assertThatCode(() -> AddressRules.checkCanAdd(9)).doesNotThrowAnyException();
        assertThatThrownBy(() -> AddressRules.checkCanAdd(10))
                .isInstanceOf(DomainException.class)
                .extracting(e -> ((DomainException) e).code()).isEqualTo(ErrorCode.ADDRESS_LIMIT_REACHED);
    }

    @Test
    void firstAddressAlwaysBecomesDefault() {
        assertThat(AddressRules.becomesDefault(0, null)).isTrue();
        assertThat(AddressRules.becomesDefault(0, false)).isTrue();
        assertThat(AddressRules.becomesDefault(1, null)).isFalse();
        assertThat(AddressRules.becomesDefault(1, false)).isFalse();
        assertThat(AddressRules.becomesDefault(1, true)).isTrue();
    }
}
