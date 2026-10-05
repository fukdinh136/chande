package com.chande.userservice.domain.user;

import com.chande.userservice.domain.common.DomainException;
import com.chande.userservice.domain.common.ErrorCode;

import java.util.Objects;
import java.util.regex.Pattern;

/** SĐT di động Việt Nam đã chuẩn hoá về dạng {@code +84xxxxxxxxx}. */
public record PhoneNumber(String value) {

    private static final Pattern SEPARATORS = Pattern.compile("[\\s.\\-()]");
    private static final Pattern VN_MOBILE = Pattern.compile("^\\+84(3|5|7|8|9)\\d{8}$");

    public PhoneNumber {
        Objects.requireNonNull(value, "value");
    }

    /**
     * BR-01: xoá khoảng trắng ASCII, '.', '-', '(', ')'; đầu "0" -> "+84", đầu "84" -> thêm "+",
     * đầu "+84" giữ nguyên, còn lại là lỗi; kết quả phải khớp {@code ^\+84(3|5|7|8|9)\d{8}$}.
     *
     * @throws DomainException {@link ErrorCode#INVALID_PHONE_NUMBER}
     */
    public static PhoneNumber parse(String raw) {
        if (raw == null) {
            throw new DomainException(ErrorCode.INVALID_PHONE_NUMBER);
        }
        String phone = SEPARATORS.matcher(raw).replaceAll("");
        if (phone.startsWith("0")) {
            phone = "+84" + phone.substring(1);
        } else if (phone.startsWith("84")) {
            phone = "+" + phone;
        } else if (!phone.startsWith("+84")) {
            throw new DomainException(ErrorCode.INVALID_PHONE_NUMBER);
        }
        if (!VN_MOBILE.matcher(phone).matches()) {
            throw new DomainException(ErrorCode.INVALID_PHONE_NUMBER);
        }
        return new PhoneNumber(phone);
    }

    @Override
    public String toString() {
        return value;
    }
}
