package com.chande.api_gateway;

import com.chande.api_gateway.support.StubService;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Khởi động với cấu hình mặc định trong application.yaml: không cần service nào, Redis hay JWKS đang chạy.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ApiGatewayApplicationTests {

	@DynamicPropertySource
	static void properties(DynamicPropertyRegistry registry) {
		registry.add("gateway.internal.port", StubService::freePort);
	}

	@Test
	void contextLoads() {
	}

}
