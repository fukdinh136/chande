package com.chande.userservice.adapter.http.json;

import com.chande.userservice.application.address.AddressView;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;
import java.util.UUID;

public record AddressJson(UUID id, String label, String addressText, BigDecimal lat, BigDecimal lng,
                          @JsonProperty("isDefault") boolean isDefault, String createdAt) {

    public static AddressJson from(AddressView view) {
        return new AddressJson(view.id(), view.label(), view.addressText(), view.lat(), view.lng(), view.isDefault(),
                Timestamps.format(view.createdAt()));
    }
}
