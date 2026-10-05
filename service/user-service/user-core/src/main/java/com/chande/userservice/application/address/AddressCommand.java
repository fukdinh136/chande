package com.chande.userservice.application.address;

import com.chande.userservice.domain.common.FieldErrors;

import java.math.BigDecimal;

/** D2 (tạo) và D3 (thay toàn bộ). Khoảng toạ độ kiểm trên giá trị gốc, trước khi làm tròn. */
public record AddressCommand(String label, String addressText, BigDecimal lat, BigDecimal lng, Boolean makeDefault) {

    private static final BigDecimal LAT_MAX = BigDecimal.valueOf(90);
    private static final BigDecimal LNG_MAX = BigDecimal.valueOf(180);

    public AddressCommand {
        new FieldErrors()
                .maxLength("label", label, 50, "Tên gợi nhớ tối đa 50 ký tự")
                .required("addressText", addressText, "Địa chỉ không được để trống")
                .maxLength("addressText", addressText, 500, "Địa chỉ tối đa 500 ký tự")
                .required("lat", lat, "Thiếu vĩ độ")
                .between("lat", lat, LAT_MAX.negate(), LAT_MAX, "Vĩ độ phải từ -90 đến 90")
                .required("lng", lng, "Thiếu kinh độ")
                .between("lng", lng, LNG_MAX.negate(), LNG_MAX, "Kinh độ phải từ -180 đến 180")
                .throwIfAny();
    }
}
