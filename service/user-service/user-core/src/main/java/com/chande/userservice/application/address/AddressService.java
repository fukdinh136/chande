package com.chande.userservice.application.address;

import com.chande.userservice.application.port.AddressRepository;
import com.chande.userservice.application.port.IdGenerator;
import com.chande.userservice.application.port.TransactionRunner;
import com.chande.userservice.application.port.UserRepository;
import com.chande.userservice.domain.address.Address;
import com.chande.userservice.domain.address.AddressRules;
import com.chande.userservice.domain.common.DomainException;
import com.chande.userservice.domain.common.ErrorCode;

import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * Địa chỉ đã lưu (D1–D5). Mọi thao tác ghi chạy trong một transaction và khoá dòng user trước, để các thao tác
 * địa chỉ của cùng một user chạy lần lượt (không vượt 10 địa chỉ, không tranh nhau cờ mặc định).
 * Luôn bỏ cờ mặc định cũ <b>trước</b> khi đặt cờ mới, để không vi phạm unique index một-mặc-định.
 */
public final class AddressService {

    private final AddressRepository addresses;
    private final UserRepository users;
    private final IdGenerator ids;
    private final TransactionRunner tx;
    private final Clock clock;

    public AddressService(AddressRepository addresses, UserRepository users, IdGenerator ids,
                          TransactionRunner tx, Clock clock) {
        this.addresses = Objects.requireNonNull(addresses);
        this.users = Objects.requireNonNull(users);
        this.ids = Objects.requireNonNull(ids);
        this.tx = Objects.requireNonNull(tx);
        this.clock = Objects.requireNonNull(clock);
    }

    /** D1: mặc định lên đầu, sau đó mới nhất trước. */
    public List<AddressView> list(UUID userId) {
        return addresses.listByUser(userId).stream().map(AddressView::from).toList();
    }

    /** D2. */
    public AddressView create(UUID userId, AddressCommand cmd) {
        return tx.inTransaction(() -> {
            users.lockForUpdate(userId);
            long count = addresses.countByUser(userId);
            AddressRules.checkCanAdd(count);
            boolean makeDefault = AddressRules.becomesDefault(count, cmd.makeDefault());
            if (makeDefault) {
                addresses.clearDefault(userId);
            }
            Address address = Address.create(ids.newId(), userId, cmd.label(), cmd.addressText(), cmd.lat(), cmd.lng(),
                    makeDefault, clock.instant().truncatedTo(ChronoUnit.MICROS));
            addresses.insert(address);
            return AddressView.from(address);
        });
    }

    /** D3. {@code makeDefault} false/null giữ nguyên cờ hiện tại: không bỏ được cờ mặc định qua API này. */
    public AddressView update(UUID userId, UUID addressId, AddressCommand cmd) {
        return tx.inTransaction(() -> {
            users.lockForUpdate(userId);
            Address address = findOwned(userId, addressId);
            if (Boolean.TRUE.equals(cmd.makeDefault())) {
                addresses.clearDefault(userId);
                address.markDefault();
            }
            address.replaceDetails(cmd.label(), cmd.addressText(), cmd.lat(), cmd.lng());
            addresses.update(address);
            return AddressView.from(address);
        });
    }

    /** D4. */
    public AddressView setDefault(UUID userId, UUID addressId) {
        return tx.inTransaction(() -> {
            users.lockForUpdate(userId);
            Address address = findOwned(userId, addressId);
            addresses.clearDefault(userId);
            address.markDefault();
            addresses.update(address);
            return AddressView.from(address);
        });
    }

    /** D5. Xoá địa chỉ mặc định thì địa chỉ mới nhất còn lại lên thay (BR-23). */
    public void delete(UUID userId, UUID addressId) {
        tx.inTransaction(() -> {
            users.lockForUpdate(userId);
            Address address = findOwned(userId, addressId);
            addresses.delete(address.id());
            if (address.isDefault()) {
                addresses.findNewest(userId).ifPresent(next -> {
                    next.markDefault();
                    addresses.update(next);
                });
            }
            return null;
        });
    }

    /** BR-24: địa chỉ của user khác coi như không tồn tại. */
    private Address findOwned(UUID userId, UUID addressId) {
        return addresses.findOwned(userId, addressId)
                .orElseThrow(() -> new DomainException(ErrorCode.ADDRESS_NOT_FOUND));
    }
}
