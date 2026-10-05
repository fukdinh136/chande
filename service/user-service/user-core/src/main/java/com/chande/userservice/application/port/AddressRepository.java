package com.chande.userservice.application.port;

import com.chande.userservice.domain.address.Address;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AddressRepository {

    /** Sắp xếp {@code is_default DESC, created_at DESC}. */
    List<Address> listByUser(UUID userId);

    /** Chỉ trả về địa chỉ thuộc đúng user (BR-24). */
    Optional<Address> findOwned(UUID userId, UUID addressId);

    long countByUser(UUID userId);

    /** Địa chỉ mới nhất theo {@code created_at DESC}. */
    Optional<Address> findNewest(UUID userId);

    /** Bỏ cờ mặc định của mọi địa chỉ của user. @return số dòng đã đổi */
    int clearDefault(UUID userId);

    void insert(Address address);

    /** Ghi label, address_text, lat, lng, is_default. */
    void update(Address address);

    void delete(UUID addressId);
}
