package com.chande.userservice.adapter.http;

record Route(String method, PathTemplate path, Access access, Handler handler) {
}
