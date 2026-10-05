package com.chande.userservice.application.address;

import com.chande.userservice.domain.common.DomainException;
import com.chande.userservice.domain.common.ErrorCode;
import com.chande.userservice.domain.user.User;
import com.chande.userservice.domain.user.UserStatus;
import com.chande.userservice.testing.InMemoryWorld;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Duration;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AddressServiceTest {

    private final InMemoryWorld w = new InMemoryWorld();
    private UUID userId;

    @BeforeEach
    void setUp() {
        userId = w.seedUser("+84912345678", "matkhau123", UserStatus.ACTIVE).id();
    }

    private static AddressCommand cmd(String label, Boolean makeDefault) {
        return new AddressCommand(label, " " + label + " street ", new BigDecimal("21.017"), new BigDecimal("105.784"),
                makeDefault);
    }

    /** Mỗi địa chỉ tạo cách nhau 1 giây để thứ tự created_at rõ ràng. */
    private AddressView create(String label, Boolean makeDefault) {
        w.clock.advance(Duration.ofSeconds(1));
        return w.address.create(userId, cmd(label, makeDefault));
    }

    private static void assertFails(ThrowingCallable call, ErrorCode code) {
        assertThatThrownBy(call).isInstanceOf(DomainException.class)
                .extracting(e -> ((DomainException) e).code()).isEqualTo(code);
    }

    private List<String> labelsInListOrder() {
        return w.address.list(userId).stream().map(AddressView::label).toList();
    }

    private String defaultLabel() {
        return w.address.list(userId).stream().filter(AddressView::isDefault).map(AddressView::label)
                .reduce((a, b) -> {
                    throw new AssertionError("more than one default");
                }).orElse(null);
    }

    @Test
    void firstAddressBecomesDefaultAndIsNormalized() {
        AddressView view = w.address.create(userId,
                new AddressCommand("  Nhà ", "  Keangnam Landmark 72  ", new BigDecimal("21.017"),
                        new BigDecimal("105.784"), false));

        assertThat(view.isDefault()).isTrue();
        assertThat(view.label()).isEqualTo("Nhà");
        assertThat(view.addressText()).isEqualTo("Keangnam Landmark 72");
        assertThat(view.lat().toPlainString()).isEqualTo("21.01700000");
        assertThat(view.lng().toPlainString()).isEqualTo("105.78400000");
        assertThat(w.users.locks()).isEqualTo(1);
    }

    @Test
    void secondAddressWithoutFlagIsNotDefault() {
        create("A", null);
        AddressView second = create("B", null);

        assertThat(second.isDefault()).isFalse();
        assertThat(defaultLabel()).isEqualTo("A");
    }

    @Test
    void createWithMakeDefaultMovesTheFlag() {
        create("A", null);
        create("B", true);

        assertThat(defaultLabel()).isEqualTo("B");
    }

    @Test
    void listPutsDefaultFirstThenNewest() {
        create("A", null);
        create("B", null);
        create("C", null);

        assertThat(labelsInListOrder()).containsExactly("A", "C", "B");
        assertThat(w.address.list(UUID.randomUUID())).isEmpty();
    }

    @Test
    void elevenththAddressIsRejected() {
        for (int i = 0; i < 10; i++) {
            create("L" + i, null);
        }
        assertFails(() -> create("L10", null), ErrorCode.ADDRESS_LIMIT_REACHED);
        assertThat(w.addresses.count()).isEqualTo(10);
    }

    @Test
    void updateReplacesAllFieldsAndKeepsFlag() {
        AddressView a = create("A", null);

        AddressView updated = w.address.update(userId, a.id(),
                new AddressCommand(null, "Mới", new BigDecimal("-1"), new BigDecimal("2"), false));

        assertThat(updated.label()).isNull();
        assertThat(updated.addressText()).isEqualTo("Mới");
        assertThat(updated.lat().toPlainString()).isEqualTo("-1.00000000");
        assertThat(updated.isDefault()).isTrue();
        assertThat(updated.createdAt()).isEqualTo(a.createdAt());
    }

    @Test
    void updateWithMakeDefaultClearsOldDefaultFirst() {
        create("A", null);
        AddressView b = create("B", null);

        AddressView updated = w.address.update(userId, b.id(), cmd("B2", true));

        assertThat(updated.isDefault()).isTrue();
        assertThat(defaultLabel()).isEqualTo("B2");
    }

    @Test
    void updateCannotUnsetDefault() {
        AddressView a = create("A", null);
        assertThat(w.address.update(userId, a.id(), cmd("A", false)).isDefault()).isTrue();
    }

    @Test
    void setDefault() {
        create("A", null);
        AddressView b = create("B", null);

        assertThat(w.address.setDefault(userId, b.id()).isDefault()).isTrue();
        assertThat(defaultLabel()).isEqualTo("B");
        // đặt lại chính địa chỉ đang là mặc định vẫn hợp lệ
        assertThat(w.address.setDefault(userId, b.id()).isDefault()).isTrue();
    }

    @Test
    void otherUsersAddressIsTreatedAsMissing() {
        AddressView a = create("A", null);
        User other = w.seedUser("+84987654321", "matkhau123", UserStatus.ACTIVE);

        assertFails(() -> w.address.setDefault(other.id(), a.id()), ErrorCode.ADDRESS_NOT_FOUND);
        assertFails(() -> w.address.update(other.id(), a.id(), cmd("X", true)), ErrorCode.ADDRESS_NOT_FOUND);
        assertFails(() -> w.address.delete(other.id(), a.id()), ErrorCode.ADDRESS_NOT_FOUND);
        assertThat(w.address.list(userId)).hasSize(1);
        assertThat(defaultLabel()).isEqualTo("A");
    }

    @Test
    void deletingDefaultPromotesNewestRemaining() {
        AddressView a = create("A", null);
        create("B", null);
        create("C", null);

        w.address.delete(userId, a.id());

        assertThat(defaultLabel()).isEqualTo("C");
        assertThat(w.address.list(userId)).hasSize(2);
    }

    @Test
    void deletingNonDefaultKeepsDefault() {
        create("A", null);
        AddressView b = create("B", null);
        create("C", null);

        w.address.delete(userId, b.id());

        assertThat(defaultLabel()).isEqualTo("A");
    }

    @Test
    void deletingLastAddressLeavesEmptyList() {
        AddressView a = create("A", null);
        w.address.delete(userId, a.id());
        assertThat(w.address.list(userId)).isEmpty();
    }

    @Test
    void missingAddress() {
        assertFails(() -> w.address.delete(userId, UUID.randomUUID()), ErrorCode.ADDRESS_NOT_FOUND);
    }

    @Test
    void everyWriteLocksTheUserRow() {
        AddressView a = create("A", null);
        w.address.update(userId, a.id(), cmd("A", null));
        w.address.setDefault(userId, a.id());
        w.address.delete(userId, a.id());
        assertThat(w.users.locks()).isEqualTo(4);
    }
}
