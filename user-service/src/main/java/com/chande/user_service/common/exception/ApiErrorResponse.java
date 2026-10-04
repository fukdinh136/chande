package com.chande.user_service.common.exception;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.Map;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiErrorResponse(String code, String message, Map<String, String> fieldErrors)  {

    public static ApiErrorResponse of(ErrorCode errorCode){
        return new ApiErrorResponse(errorCode.name(), errorCode.getMessage(), null);
    }

    public static ApiErrorResponse of(ErrorCode errorCode, Map<String, String> fieldErrors){
       return new ApiErrorResponse(errorCode.name(), errorCode.getMessage(),fieldErrors);
    }
}
