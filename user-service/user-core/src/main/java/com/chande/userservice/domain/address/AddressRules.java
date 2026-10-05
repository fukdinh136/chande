package com.chande.userservice.domain.address;

import com.chande.userservice.domain.common.DomainException;
import com.chande.userservice.domain.common.ErrorCode;

import java.math.BigDecimal;
import java.math.RoundingMode;

/** Quy tắc địa chỉ đã lưu (BR-21, BR-22, BR-23). */
public final class AddressRules {

    /** BR-22 */
    public static final int MAX_ADDRESSES = 10;
    /** Khớp numeric(10,8) / numeric(11,8) trong DB. */
    public static final int COORDINATE_SCALE = 8;

    private AddressRules() {
    }

    /** @throws DomainException {@link ErrorCode#ADDRESS_LIMIT_REACHED} khi đã có đủ 10 địa chỉ */
    public static void checkCanAdd(long currentCount) {
        if (currentCount >= MAX_ADDRESSES) {
            throw new DomainException(ErrorCode.ADDRESS_LIMIT_REACHED);
        }
    }

    /** BR-23: địa chỉ đầu tiên luôn là mặc định; các địa chỉ sau chỉ khi client yêu cầu. */
    public static boolean becomesDefault(long currentCount, Boolean makeDefault) {
        return currentCount == 0 || Boolean.TRUE.equals(makeDefault);
    }

    /** BR-21: null hoặc rỗng sau trim thì lưu null; ngược lại lưu bản đã trim. */
    static String normalizeLabel(String label) {
        if (label == null) {
            return null;
        }
        String trimmed = label.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    /** BR-21: làm tròn 8 chữ số thập phân, HALF_UP. Khoảng giá trị đã được kiểm trước khi làm tròn. */
    static BigDecimal normalizeCoordinate(BigDecimal value) {
        return value.setScale(COORDINATE_SCALE, RoundingMode.HALF_UP);
    }
}
