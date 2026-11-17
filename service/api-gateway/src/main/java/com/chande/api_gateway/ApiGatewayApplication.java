package com.chande.api_gateway;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class ApiGatewayApplication {

	/** Tomcat reads this once when its WebSocket classes load: the size of the per-session frame and send buffers. */
	static final String WEBSOCKET_BUFFER_SIZE = "org.apache.tomcat.websocket.DEFAULT_BUFFER_SIZE";

	public static void main(String[] args) {
		// Every open /ws session holds several of these buffers (8 KB each by default); app messages are under 1 KB.
		// A value given with -D on the command line wins.
		if (System.getProperty(WEBSOCKET_BUFFER_SIZE) == null) {
			System.setProperty(WEBSOCKET_BUFFER_SIZE, "2048");
		}
		SpringApplication.run(ApiGatewayApplication.class, args);
	}
}