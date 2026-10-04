package com.chande.user_service.address.dto;

import com.chande.user_service.address.UserAddress;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;

public record AddressResponse(
        UUID id,
        String label,
        String addressText,
        BigDecimal lat,
        BigDecimal lng,
        boolean isDefault,
        OffsetDateTime  createdAt
) {
    public static AddressResponse from(UserAddress address){
        return  new AddressResponse(
                address.getId(),
                address.getLabel(),
                address.getAddressText(),
                address.getLat(),
                address.getLng(),
                address.isDefaultAddress(),
                address.getCreatedAt()
        );
    }
}
