package com.chande.userservice.testing;

import com.chande.userservice.application.port.TransactionRunner;

import java.util.function.Supplier;

/** Gọi thẳng {@code work.get()}; đếm số transaction để test kiểm phạm vi giao dịch. */
public final class DirectTransactionRunner implements TransactionRunner {

    private int transactions;

    @Override
    public <T> T inTransaction(Supplier<T> work) {
        transactions++;
        return work.get();
    }

    @Override
    public <T> T readOnly(Supplier<T> work) {
        return work.get();
    }

    public int transactions() {
        return transactions;
    }
}
