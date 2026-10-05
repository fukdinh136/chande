package com.chande.userservice.adapter.http;

/** Mức truy cập của một route (mục 2). */
public enum Access {
    /** Không cần xác thực; bỏ qua mọi header xác thực (app hay gắn access token đã hết hạn khi refresh/logout). */
    PUBLIC,
    /** Bắt buộc {@code Authorization: Bearer <access JWT>} với role RIDER. */
    RIDER,
    /** Bắt buộc {@code X-Internal-Key}. */
    INTERNAL
}
