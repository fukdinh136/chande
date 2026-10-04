package com.chande.user_service.common.util;

import com.chande.user_service.common.exception.ApiException;
import com.chande.user_service.common.exception.ErrorCode;


import java.util.regex.Pattern;

public final class PhoneNumberUtil {
    private static final Pattern VN_MOBILE = Pattern.compile("^\\+84(3|5|7|8|9)\\d{8}$");

    public static String normalize(String raw){
        if (raw == null ) throw new ApiException(ErrorCode.INVALID_PHONE_NUMBER);
        String phone = raw.replaceAll("[\\s.\\-()]", "");
        if(phone.startsWith("0")) {
            phone = "+84" + phone.substring(1);
        } else if(phone.startsWith("84")) {
            phone = "+" + phone;
        } else if(!phone.startsWith("+84"))
            throw  new ApiException(ErrorCode.INVALID_PHONE_NUMBER);

        if(!VN_MOBILE.matcher(phone).matches()){
            throw new  ApiException(ErrorCode.INVALID_PHONE_NUMBER);
        }
        return phone;
    }
}
