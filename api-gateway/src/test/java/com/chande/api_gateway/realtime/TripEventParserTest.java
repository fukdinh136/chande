package com.chande.api_gateway.realtime;

import com.chande.api_gateway.error.ErrorDetail;
import com.chande.api_gateway.error.GatewayException;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class TripEventParserTest {

    private static final String ASSIGNED = """
            {"schemaVersion":1,"eventId":"60000000-0000-4000-8000-000000000002","type":"trip.assigned",
             "tripId":"20000000-0000-4000-8000-000000000001","tripVersion":2,"occurredAt":"2026-10-05T02:02:00.000Z",
             "data":{"riderId":"30000000-0000-4000-8000-000000000001",
                     "driverId":"40000000-0000-4000-8000-000000000001","status":"ASSIGNED"}}""";

    private final TripEventParser parser = new TripEventParser(JsonMapper.builder().build());

    private TripEvent parse(String json) {
        return parser.parse(json.getBytes(StandardCharsets.UTF_8));
    }

    private void assertRejected(String json, String field) {
        assertThatThrownBy(() -> parse(json))
                .isInstanceOfSatisfying(GatewayException.class, ex ->
                        assertThat(ex.getDetails()).extracting(ErrorDetail::field).contains(field));
    }

    @Test
    void parsesTheEnvelopeFromTripDocs() {
        TripEvent event = parse(ASSIGNED);
        assertThat(event.eventId()).isEqualTo(UUID.fromString("60000000-0000-4000-8000-000000000002"));
        assertThat(event.tripVersion()).isEqualTo(2);
        assertThat(event.driverId()).isEqualTo(UUID.fromString("40000000-0000-4000-8000-000000000001"));
    }

    @Test
    void canonicalJsonIgnoresFormattingDifferences() {
        String reformatted = ASSIGNED.replace("02:02:00.000Z", "02:02:00Z").replace("\n", "").replace(" ", "");
        assertThat(parse(reformatted).toCanonicalJson()).isEqualTo(parse(ASSIGNED).toCanonicalJson());
        assertThat(parse(ASSIGNED).toCanonicalJson()).isEqualTo("{\"schemaVersion\":1,"
                + "\"eventId\":\"60000000-0000-4000-8000-000000000002\",\"type\":\"trip.assigned\","
                + "\"tripId\":\"20000000-0000-4000-8000-000000000001\",\"tripVersion\":2,"
                + "\"occurredAt\":\"2026-10-05T02:02:00Z\",\"data\":{\"riderId\":\"30000000-0000-4000-8000-000000000001\","
                + "\"driverId\":\"40000000-0000-4000-8000-000000000001\",\"status\":\"ASSIGNED\"}}");
    }

    @Test
    void searchingEventHasNoDriver() {
        TripEvent event = parse(ASSIGNED.replace("trip.assigned", "trip.searching")
                .replace("\"ASSIGNED\"", "\"SEARCHING\"")
                .replace("\"40000000-0000-4000-8000-000000000001\"", "null")
                .replace("\"tripVersion\":2", "\"tripVersion\":1"));
        assertThat(event.driverId()).isNull();
        assertThat(event.toCanonicalJson()).contains("\"driverId\":null");
    }

    @Test
    void rejectsInvalidEnvelopes() {
        assertRejected("[]", "body");
        assertRejected("not json", "body");
        assertRejected(ASSIGNED.replace("\"schemaVersion\":1", "\"schemaVersion\":2"), "schemaVersion");
        assertRejected(ASSIGNED.replace("trip.assigned", "trip.teleported"), "type");
        assertRejected(ASSIGNED.replace("\"tripVersion\":2", "\"tripVersion\":0"), "tripVersion");
        assertRejected(ASSIGNED.replace("\"tripVersion\":2", "\"tripVersion\":\"2\""), "tripVersion");
        assertRejected(ASSIGNED.replace("2026-10-05T02:02:00.000Z", "hôm qua"), "occurredAt");
        assertRejected(ASSIGNED.replace("60000000-0000-4000-8000-000000000002", "1-1-1-1-1"), "eventId");
        assertRejected(ASSIGNED.replace("\"ASSIGNED\"", "\"COMPLETED\""), "data.status");
        assertRejected(ASSIGNED.replace("\"40000000-0000-4000-8000-000000000001\"", "null"), "data.driverId");
        assertRejected(ASSIGNED.replace("\"schemaVersion\":1", "\"schemaVersion\":1,\"extra\":true"), "extra");
        assertRejected(ASSIGNED.replace("\"status\":\"ASSIGNED\"", "\"status\":\"ASSIGNED\",\"phone\":\"x\""), "data.phone");
    }
}
