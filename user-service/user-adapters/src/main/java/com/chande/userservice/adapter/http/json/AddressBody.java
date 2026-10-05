package com.chande.userservice.adapter.http.json;

import com.chande.userservice.application.address.AddressCommand;

import java.math.BigDecimal;

public record AddressBody(String label, String addressText, BigDecimal lat, BigDecimal lng, Boolean makeDefault) {

    public AddressCommand toCommand() {
        return new AddressCommand(label, addressText, lat, lng, makeDefault);
    }
}
