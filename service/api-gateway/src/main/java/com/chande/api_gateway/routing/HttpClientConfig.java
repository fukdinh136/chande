package com.chande.api_gateway.routing;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.ClientHttpRequestFactory;
import org.springframework.http.client.JdkClientHttpRequestFactory;

import java.net.http.HttpClient;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * HTTP client gateway dùng để gọi các service. Spring Cloud Gateway tự dùng bean này cho proxy.
 * <ul>
 *   <li>HTTP/1.1 + keep-alive: tái sử dụng kết nối tới service, không mở kết nối mới cho từng request.</li>
 *   <li>Timeout kết nối ngắn để failover nhanh; timeout tổng để service treo không giữ request mãi.</li>
 *   <li>Không tự đi theo redirect: trả nguyên response của service cho client.</li>
 * </ul>
 */
@Configuration
public class HttpClientConfig {

    @Bean
    public ClientHttpRequestFactory gatewayClientHttpRequestFactory(RoutingProperties properties) {
        // Tác vụ nội bộ của JDK HttpClient chạy trên platform thread, KHÔNG dùng virtual thread:
        // trên JDK 21, HttpClient giữ khoá trong các khối synchronized làm virtual thread bị "pin";
        // dưới tải cao toàn bộ carrier thread bị chiếm và gateway treo (đã tái hiện bằng test đồng thời).
        // Request của client vẫn chạy trên virtual thread và chỉ chờ kết quả, không bị ảnh hưởng.
        ExecutorService executor = Executors.newCachedThreadPool(
                Thread.ofPlatform().name("gateway-http-", 0).daemon().factory());
        HttpClient httpClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(properties.connectTimeout())
                .followRedirects(HttpClient.Redirect.NEVER)
                .executor(executor)
                .build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(httpClient, executor);
        factory.setReadTimeout(properties.readTimeout());
        return factory;
    }
}
