package com.chande.userservice.adapter.http.handler;

import com.chande.userservice.adapter.http.HttpRequest;
import com.chande.userservice.adapter.http.HttpResult;
import com.chande.userservice.adapter.http.json.AddressBody;
import com.chande.userservice.adapter.http.json.AddressJson;
import com.chande.userservice.application.address.AddressService;

/** D1–D5. */
public final class AddressHandlers {

    private final AddressService addresses;

    public AddressHandlers(AddressService addresses) {
        this.addresses = addresses;
    }

    public HttpResult list(HttpRequest req) {
        return HttpResult.ok(addresses.list(req.userId()).stream().map(AddressJson::from).toList());
    }

    public HttpResult create(HttpRequest req) {
        AddressBody body = req.json(AddressBody.class);
        return HttpResult.created(AddressJson.from(addresses.create(req.userId(), body.toCommand())));
    }

    public HttpResult update(HttpRequest req) {
        var addressId = req.pathUuid("addressId");
        AddressBody body = req.json(AddressBody.class);
        return HttpResult.ok(AddressJson.from(addresses.update(req.userId(), addressId, body.toCommand())));
    }

    /** Không có body. */
    public HttpResult setDefault(HttpRequest req) {
        return HttpResult.ok(AddressJson.from(addresses.setDefault(req.userId(), req.pathUuid("addressId"))));
    }

    public HttpResult delete(HttpRequest req) {
        addresses.delete(req.userId(), req.pathUuid("addressId"));
        return HttpResult.noContent();
    }
}
