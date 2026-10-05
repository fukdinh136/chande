package com.chande.api_gateway.realtime;

/**
 * Nơi lưu bền vững sự kiện chuyến trước khi trả 202 cho Trip (tài liệu Driver mục 13: không được ACK
 * khi mới chỉ giữ trong bộ nhớ).
 */
public interface TripEventInbox {

    enum Outcome {
        /** Sự kiện mới, đã lưu và đã phát cho các gateway để đẩy xuống app. */
        ACCEPTED,
        /** eventId đã nhận trước đó với cùng nội dung (Trip retry): trả lại 202, không phát lại. */
        DUPLICATE,
        /** Đã lưu nhưng không phát vì chuyến đã có version mới hơn (sự kiện đến trễ, sai thứ tự). */
        STALE,
        /** eventId đã dùng cho nội dung khác: 409. */
        CONFLICT
    }

    Outcome store(TripEvent event);
}
