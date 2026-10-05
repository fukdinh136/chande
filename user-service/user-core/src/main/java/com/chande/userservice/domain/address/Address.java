package com.chande.userservice.domain.address;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/** Địa chỉ đã lưu của một user. Giá trị luôn ở dạng đã chuẩn hoá (BR-21). */
public final class Address {

    private final UUID id;
    private final UUID userId;
    private String label;
    private String addressText;
    private BigDecimal lat;
    private BigDecimal lng;
    private boolean isDefault;
    private final Instant createdAt;

    private Address(UUID id, UUID userId, String label, String addressText, BigDecimal lat, BigDecimal lng,
                    boolean isDefault, Instant createdAt) {
        this.id = Objects.requireNonNull(id, "id");
        this.userId = Objects.requireNonNull(userId, "userId");
        this.label = label;
        this.addressText = Objects.requireNonNull(addressText, "addressText");
        this.lat = Objects.requireNonNull(lat, "lat");
        this.lng = Objects.requireNonNull(lng, "lng");
        this.isDefault = isDefault;
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt");
    }

    public static Address create(UUID id, UUID userId, String label, String addressText,
                                 BigDecimal lat, BigDecimal lng, boolean isDefault, Instant now) {
        Address address = new Address(id, userId, null, addressText, lat, lng, isDefault, now);
        address.replaceDetails(label, addressText, lat, lng);
        return address;
    }

    public static Address restore(UUID id, UUID userId, String label, String addressText,
                                  BigDecimal lat, BigDecimal lng, boolean isDefault, Instant createdAt) {
        return new Address(id, userId, label, addressText, lat, lng, isDefault, createdAt);
    }

    /** Thay toàn bộ nội dung (PUT). Bỏ label thì label về null. Không đụng tới cờ mặc định. */
    public void replaceDetails(String newLabel, String newAddressText, BigDecimal newLat, BigDecimal newLng) {
        label = AddressRules.normalizeLabel(newLabel);
        addressText = newAddressText.trim();
        lat = AddressRules.normalizeCoordinate(newLat);
        lng = AddressRules.normalizeCoordinate(newLng);
    }

    public void markDefault() {
        isDefault = true;
    }

    public UUID id() {
        return id;
    }

    public UUID userId() {
        return userId;
    }

    public String label() {
        return label;
    }

    public String addressText() {
        return addressText;
    }

    public BigDecimal lat() {
        return lat;
    }

    public BigDecimal lng() {
        return lng;
    }

    public boolean isDefault() {
        return isDefault;
    }

    public Instant createdAt() {
        return createdAt;
    }
}
