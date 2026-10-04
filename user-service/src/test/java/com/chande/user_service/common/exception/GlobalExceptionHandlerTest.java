package com.chande.user_service.common.exception;

import com.chande.user_service.auth.AuthController;
import com.chande.user_service.auth.AuthService;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.mockito.Mockito.mock;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Kiểm tra lỗi do Spring MVC sinh ra (trước khi vào controller) cũng ra JSON {code, message}, không thành 500
class GlobalExceptionHandlerTest {

    private final MockMvc mvc = MockMvcBuilders
            .standaloneSetup(new AuthController(mock(AuthService.class)))
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();

    @Test
    void wrongContentType_returns415() throws Exception {
        mvc.perform(post("/api/v1/users/auth/login").contentType(MediaType.TEXT_PLAIN).content("abc"))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.code").value("UNSUPPORTED_MEDIA_TYPE"));
    }

    @Test
    void missingContentType_returns415() throws Exception {
        mvc.perform(post("/api/v1/users/auth/refresh").content("{\"refreshToken\":\"x\"}"))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.code").value("UNSUPPORTED_MEDIA_TYPE"));
    }

    @Test
    void validationError_isJsonEvenWhenClientAcceptsXml() throws Exception {
        mvc.perform(post("/api/v1/users/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .accept(MediaType.APPLICATION_XML)
                        .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentType(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.fieldErrors.phoneNumber").exists());
    }
}
