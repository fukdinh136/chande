package com.chande.userservice.testing;

import com.chande.userservice.application.port.AddressRepository;
import com.chande.userservice.domain.address.Address;
import com.chande.userservice.domain.common.DomainException;
import com.chande.userservice.domain.common.ErrorCode;

import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Giả lập cả các ràng buộc của DB: FK tới users và partial unique index "mỗi user tối đa 1 mặc định"
 * (vi phạm -> DATA_CONFLICT như SqlErrors), để test bắt được lỗi thứ tự "đặt mặc định trước khi bỏ cờ cũ".
 */
public final class InMemoryAddressRepository implements AddressRepository {

    private static final Comparator<Address> NEWEST_FIRST = Comparator.comparing(Address::createdAt).reversed();

    private final Map<UUID, Address> rows = new LinkedHashMap<>();
    private final InMemoryUserRepository users;

    public InMemoryAddressRepository(InMemoryUserRepository users) {
        this.users = users;
    }

    @Override
    public synchronized List<Address> listByUser(UUID userId) {
        return rows.values().stream().filter(a -> a.userId().equals(userId))
                .sorted(Comparator.comparing(Address::isDefault).reversed().thenComparing(NEWEST_FIRST))
                .map(InMemoryAddressRepository::copy).toList();
    }

    @Override
    public synchronized Optional<Address> findOwned(UUID userId, UUID addressId) {
        return Optional.ofNullable(rows.get(addressId)).filter(a -> a.userId().equals(userId))
                .map(InMemoryAddressRepository::copy);
    }

    @Override
    public synchronized long countByUser(UUID userId) {
        return rows.values().stream().filter(a -> a.userId().equals(userId)).count();
    }

    @Override
    public synchronized Optional<Address> findNewest(UUID userId) {
        return rows.values().stream().filter(a -> a.userId().equals(userId)).sorted(NEWEST_FIRST).findFirst()
                .map(InMemoryAddressRepository::copy);
    }

    @Override
    public synchronized int clearDefault(UUID userId) {
        int changed = 0;
        for (Address a : List.copyOf(rows.values())) {
            if (a.userId().equals(userId) && a.isDefault()) {
                rows.put(a.id(), Address.restore(a.id(), a.userId(), a.label(), a.addressText(), a.lat(), a.lng(),
                        false, a.createdAt()));
                changed++;
            }
        }
        return changed;
    }

    @Override
    public synchronized void insert(Address address) {
        if (!users.exists(address.userId())) {
            throw new DomainException(ErrorCode.DATA_CONFLICT);
        }
        checkOneDefault(address);
        rows.put(address.id(), copy(address));
    }

    @Override
    public synchronized void update(Address address) {
        if (rows.containsKey(address.id())) {
            checkOneDefault(address);
            rows.put(address.id(), copy(address));
        }
    }

    @Override
    public synchronized void delete(UUID addressId) {
        rows.remove(addressId);
    }

    public synchronized int count() {
        return rows.size();
    }

    private void checkOneDefault(Address address) {
        if (address.isDefault() && rows.values().stream().anyMatch(a ->
                a.userId().equals(address.userId()) && a.isDefault() && !a.id().equals(address.id()))) {
            throw new DomainException(ErrorCode.DATA_CONFLICT);
        }
    }

    private static Address copy(Address a) {
        return Address.restore(a.id(), a.userId(), a.label(), a.addressText(), a.lat(), a.lng(), a.isDefault(),
                a.createdAt());
    }
}
