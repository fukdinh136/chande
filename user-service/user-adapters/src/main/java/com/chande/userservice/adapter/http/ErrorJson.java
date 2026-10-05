package com.chande.userservice.adapter.http;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.Map;

/** Body lỗi (mục 2.1): {@code fieldErrors} chỉ có khi lỗi gắn được với từng trường; không có thì bỏ hẳn key. */
public record ErrorJson(String code, String message,
                        @JsonInclude(JsonInclude.Include.NON_NULL) Map<String, String> fieldErrors) {
}
