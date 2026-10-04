package com.chande.user_service.address.dto;

import jakarta.validation.constraints.*;

import java.math.BigDecimal;

public record AddressRequest(
        @Size(max = 50, message = "Tên gợi nhớ tối đa 50 ký tự")
        String label,
        @Size(max = 500, message = "Địa chỉ tối đa 500 ký tự") @NotBlank(message = "Địa chỉ không được để trống")
        String addressText,
        @NotNull(message ="Thiếu vĩ độ") @DecimalMin(value = "-90", message = "Vĩ độ phải từ -90 đến 90") @DecimalMax(value = "90",message = "Vĩ độ phải từ -90 đến 90")
        BigDecimal lat,
        @NotNull(message ="Thiếu kinh độ") @DecimalMin(value= "-180", message = "Vĩ kinh phải từ -180 đến 180") @DecimalMax(value = "180", message = "Vĩ kinh phải từ -180 đến 180")
        BigDecimal lng,
        Boolean makeDefault
) { }
