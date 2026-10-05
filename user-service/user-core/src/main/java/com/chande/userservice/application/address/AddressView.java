package com.chande.userservice.application.address;

import com.chande.userservice.domain.address.Address;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record AddressView(UUID id, String label, String addressText, BigDecimal lat, BigDecimal lng,
                          boolean isDefault, Instant createdAt) {

    static AddressView from(Address address) {
        return new AddressView(address.id(), address.label(), address.addressText(), address.lat(), address.lng(),
                address.isDefault(), address.createdAt());
    }
}
