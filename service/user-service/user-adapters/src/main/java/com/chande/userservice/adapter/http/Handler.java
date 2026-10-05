package com.chande.userservice.adapter.http;

@FunctionalInterface
public interface Handler {

    HttpResult handle(HttpRequest request) throws Exception;
}
