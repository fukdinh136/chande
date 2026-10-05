package com.chande.userservice.domain.user;

import java.util.regex.Pattern;

/** BR-03: chính sách mật khẩu mới (đăng ký và đổi mật khẩu). */
public final class PasswordPolicy {

    public static final int MIN_LENGTH = 8;
    public static final int MAX_LENGTH = 72;
    /** BCrypt chỉ dùng 72 byte đầu; chữ có dấu chiếm 2–3 byte nên 72 ký tự có thể vượt 72 byte. */
    public static final int MAX_UTF8_BYTES = 72;
    public static final Pattern LETTER_AND_DIGIT = Pattern.compile("^(?=.*[A-Za-z])(?=.*\\d).+$");

    private PasswordPolicy() {
    }
}
