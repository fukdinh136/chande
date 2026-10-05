package com.chande.userservice.adapter.http;

import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.util.concurrent.Executors;

/** JDK HttpServer: một context "/" (Router tự khớp path), mỗi request một virtual thread. */
public final class UserHttpServer {

    private UserHttpServer() {
    }

    public static HttpServer start(InetSocketAddress address, HttpHandler handler) throws IOException {
        HttpServer server = HttpServer.create(address, 0);
        server.createContext("/", handler);
        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        server.start();
        return server;
    }
}
