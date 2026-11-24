package com.chande.userservice.application.port;

public interface PasswordHasher {

    /** @throws BusyException khi phải chờ quá lâu để được băm (service đang quá tải) */
    String hash(String raw);

    /** @throws BusyException khi phải chờ quá lâu để được băm (service đang quá tải) */
    boolean matches(String raw, String hash);

    /**
     * Quá nhiều phép băm đang chờ. Từ chối ngay thay vì xếp hàng vô hạn: client nhận lỗi sớm và thử lại sau,
     * còn request đã được nhận vẫn giữ độ trễ thấp (load shedding).
     */
    final class BusyException extends RuntimeException {

        public BusyException() {
            super("Password hashing is saturated", null, false, false);
        }
    }
}
