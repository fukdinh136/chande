package com.chande.userservice.adapter.http.handler;

import com.chande.userservice.adapter.http.HttpRequest;
import com.chande.userservice.adapter.http.HttpResult;
import com.chande.userservice.adapter.http.json.ChangePasswordBody;
import com.chande.userservice.adapter.http.json.PasswordChangedJson;
import com.chande.userservice.adapter.http.json.UpdateProfileBody;
import com.chande.userservice.adapter.http.json.UserProfileJson;
import com.chande.userservice.application.auth.AuthService;
import com.chande.userservice.application.profile.ProfileService;

/** P1–P3. */
public final class ProfileHandlers {

    private final ProfileService profile;
    private final AuthService auth;

    public ProfileHandlers(ProfileService profile, AuthService auth) {
        this.profile = profile;
        this.auth = auth;
    }

    public HttpResult get(HttpRequest req) {
        return HttpResult.ok(UserProfileJson.from(profile.getProfile(req.userId())));
    }

    public HttpResult update(HttpRequest req) {
        UpdateProfileBody body = req.json(UpdateProfileBody.class);
        return HttpResult.ok(UserProfileJson.from(profile.updateProfile(req.userId(), body.toCommand())));
    }

    /** Q4: không cấp token mới; app phải xoá token đang lưu và đăng nhập lại. */
    public HttpResult changePassword(HttpRequest req) {
        ChangePasswordBody body = req.json(ChangePasswordBody.class);
        auth.changePassword(req.userId(), body.toCommand());
        return HttpResult.ok(new PasswordChangedJson(true));
    }
}
