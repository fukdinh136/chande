package com.chande.api_gateway.error;

/**
 * Một phần tử trong {@code error.details}: chỉ chứa tên trường và lý do, không phản chiếu giá trị client gửi.
 */
public record ErrorDetail(String field, String reason) {
}
