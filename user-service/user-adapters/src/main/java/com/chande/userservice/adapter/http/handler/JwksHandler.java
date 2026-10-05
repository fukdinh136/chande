package com.chande.userservice.adapter.http.handler;

import com.chande.userservice.adapter.http.HttpRequest;
import com.chande.userservice.adapter.http.HttpResult;
import com.chande.userservice.adapter.security.JwksDocument;

/** H1: public key ký JWT. Ngoại lệ duy nhất được cache (gateway cache thêm 5 phút). */
public final class JwksHandler {

    private final JwksDocument jwks;

    public JwksHandler(JwksDocument jwks) {
        this.jwks = jwks;
    }

    public HttpResult get(HttpRequest req) {
        return HttpResult.ok(jwks).withHeader("Cache-Control", "public, max-age=60");
    }
}
