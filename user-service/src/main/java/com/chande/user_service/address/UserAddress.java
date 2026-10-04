package com.chande.user_service.address;

import com.chande.user_service.user.User;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "user_addresses")
@Getter
@Setter
@NoArgsConstructor
public class UserAddress {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column (name = "label", nullable = true, length =50 )
    private String label;

    @Column(name = "address_text", nullable = false, length = 500)
    private String addressText;

    @Column (name = "lat",nullable =false, precision = 10,scale = 8)
    private BigDecimal lat;

    @Column (name = "lng",nullable =false, precision = 11,scale = 8)
    private BigDecimal lng;

    @Column (name = "is_default", nullable =false)
    private boolean defaultAddress = false;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;
}
