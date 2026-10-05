package com.chande.userservice.adapter.http.handler;

import com.chande.userservice.adapter.http.HttpRequest;
import com.chande.userservice.adapter.http.HttpResult;
import com.chande.userservice.adapter.http.json.HealthJson;

import java.util.function.BooleanSupplier;

/** H2: 200 UP khi DB trả lời, ngược lại 503 DOWN. */
public final class HealthHandler {

    private final BooleanSupplier database;

    public HealthHandler(BooleanSupplier database) {
        this.database = database;
    }

    public HttpResult get(HttpRequest req) {
        return database.getAsBoolean()
                ? HttpResult.ok(new HealthJson("UP"))
                : HttpResult.of(503, new HealthJson("DOWN"));
    }
}
