package com.chande.userservice.domain.user;

/** BR-05: chỉ ACTIVE và BLOCKED (khớp CHECK ck_users_status). Lưu DB dạng tên enum. */
public enum UserStatus {
    ACTIVE,
    BLOCKED
}
