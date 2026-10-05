package com.chande.userservice.adapter.persistence;

/**
 * Cách repository lấy connection: đang trong transaction thì dùng connection của transaction, ngoài transaction
 * thì mượn một connection auto-commit rồi trả lại ngay. {@code SQLException} được đổi qua {@link SqlErrors}.
 */
public interface ConnectionProvider {

    <T> T withConnection(SqlWork<T> work);
}
