package com.chande.userservice.application.port;

import java.util.function.Supplier;

/**
 * Commit khi {@code work} trả về bình thường; rollback khi {@code work} ném bất kỳ exception nào.
 * Gọi lồng nhau thì dùng chung transaction ngoài.
 */
public interface TransactionRunner {

    <T> T inTransaction(Supplier<T> work);

    <T> T readOnly(Supplier<T> work);
}
