package com.chande.userservice.domain.common;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/** Lỗi validation gắn với từng trường: tên trường -> message (mỗi trường một lỗi). */
public final class ValidationException extends DomainException {

    private final Map<String, String> fieldErrors;

    public ValidationException(Map<String, String> fieldErrors) {
        super(ErrorCode.VALIDATION_ERROR);
        if (fieldErrors.isEmpty()) {
            throw new IllegalArgumentException("fieldErrors must not be empty");
        }
        this.fieldErrors = Collections.unmodifiableMap(new LinkedHashMap<>(fieldErrors));
    }

    public Map<String, String> fieldErrors() {
        return fieldErrors;
    }
}
