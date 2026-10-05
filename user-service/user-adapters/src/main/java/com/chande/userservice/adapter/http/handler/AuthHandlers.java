package com.chande.userservice.adapter.http.handler;

import com.chande.userservice.adapter.http.HttpRequest;
import com.chande.userservice.adapter.http.HttpResult;
import com.chande.userservice.adapter.http.json.LoginBody;
import com.chande.userservice.adapter.http.json.RefreshBody;
import com.chande.userservice.adapter.http.json.RegisterBody;
import com.chande.userservice.adapter.http.json.RegisterJson;
import com.chande.userservice.adapter.http.json.TokenJson;
import com.chande.userservice.application.auth.AuthService;

/** A1–A5. */
public final class AuthHandlers {

    private final AuthService auth;

    public AuthHandlers(AuthService auth) {
        this.auth = auth;
    }

    public HttpResult register(HttpRequest req) {
        RegisterBody body = req.json(RegisterBody.class);
        return HttpResult.created(RegisterJson.from(auth.register(body.toCommand())));
    }

    public HttpResult login(HttpRequest req) {
        LoginBody body = req.json(LoginBody.class);
        return HttpResult.ok(TokenJson.from(auth.login(body.toCommand())));
    }

    public HttpResult refresh(HttpRequest req) {
        RefreshBody body = req.json(RefreshBody.class);
        return HttpResult.ok(TokenJson.from(auth.refresh(body.toCommand())));
    }

    public HttpResult logout(HttpRequest req) {
        RefreshBody body = req.json(RefreshBody.class);
        auth.logout(body.toCommand());
        return HttpResult.noContent();
    }

    /** Không cần body; có body thì bỏ qua, không kiểm Content-Type. */
    public HttpResult logoutAll(HttpRequest req) {
        auth.logoutAll(req.userId());
        return HttpResult.noContent();
    }
}
