package com.chande.userservice.adapter.http;

import com.chande.userservice.adapter.http.handler.AddressHandlers;
import com.chande.userservice.adapter.http.handler.AuthHandlers;
import com.chande.userservice.adapter.http.handler.HealthHandler;
import com.chande.userservice.adapter.http.handler.InternalHandlers;
import com.chande.userservice.adapter.http.handler.JwksHandler;
import com.chande.userservice.adapter.http.handler.ProfileHandlers;
import com.chande.userservice.adapter.security.JwksDocument;
import com.chande.userservice.application.address.AddressService;
import com.chande.userservice.application.auth.AuthService;
import com.chande.userservice.application.profile.ProfileService;

import java.util.function.BooleanSupplier;

/** Bảng route: một nơi duy nhất mô tả toàn bộ API (mục 3). Path tại service không có /api/v1. */
public final class Routes {

    private Routes() {
    }

    public static Router build(AuthService authService, ProfileService profileService, AddressService addressService,
                               JwksDocument jwksDocument, BooleanSupplier databaseHealth,
                               BearerAuthenticator bearer, InternalKeyAuthenticator internalKey, int maxBodyBytes) {
        var auth = new AuthHandlers(authService);
        var profile = new ProfileHandlers(profileService, authService);
        var addresses = new AddressHandlers(addressService);
        var internal = new InternalHandlers(profileService);
        var jwks = new JwksHandler(jwksDocument);
        var health = new HealthHandler(databaseHealth);

        return new Router(bearer, internalKey, maxBodyBytes)
                .post  ("/auth/register",                          Access.PUBLIC,   auth::register)
                .post  ("/auth/login",                             Access.PUBLIC,   auth::login)
                .post  ("/auth/refresh",                           Access.PUBLIC,   auth::refresh)
                .post  ("/auth/logout",                            Access.PUBLIC,   auth::logout)
                .post  ("/auth/logout-all",                        Access.RIDER,    auth::logoutAll)
                .get   ("/users/me",                               Access.RIDER,    profile::get)
                .patch ("/users/me",                               Access.RIDER,    profile::update)
                .post  ("/users/me/password",                      Access.RIDER,    profile::changePassword)
                .get   ("/users/me/addresses",                     Access.RIDER,    addresses::list)
                .post  ("/users/me/addresses",                     Access.RIDER,    addresses::create)
                .put   ("/users/me/addresses/{addressId}",         Access.RIDER,    addresses::update)
                .put   ("/users/me/addresses/{addressId}/default", Access.RIDER,    addresses::setDefault)
                .delete("/users/me/addresses/{addressId}",         Access.RIDER,    addresses::delete)
                .get   ("/internal/users/{userId}",                Access.INTERNAL, internal::getUser)
                .get   ("/.well-known/jwks.json",                  Access.PUBLIC,   jwks::get)
                .get   ("/health",                                 Access.PUBLIC,   health::get);
    }
}
