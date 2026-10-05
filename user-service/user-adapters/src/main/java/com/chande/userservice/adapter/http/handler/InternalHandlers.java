package com.chande.userservice.adapter.http.handler;

import com.chande.userservice.adapter.http.HttpRequest;
import com.chande.userservice.adapter.http.HttpResult;
import com.chande.userservice.adapter.http.json.InternalUserJson;
import com.chande.userservice.application.profile.ProfileService;

/** I1: trip-service tra thông tin cơ bản của một user. */
public final class InternalHandlers {

    private final ProfileService profile;

    public InternalHandlers(ProfileService profile) {
        this.profile = profile;
    }

    public HttpResult getUser(HttpRequest req) {
        return HttpResult.ok(InternalUserJson.from(profile.getInternalUser(req.pathUuid("userId"))));
    }
}
