package com.chande.user_service.auth;

import com.chande.user_service.user.User;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "user_refresh_tokens")
@Getter
@Setter
@NoArgsConstructor
public class RefreshToken {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column(name = "token_hash",nullable = false, length = 64, unique =true)
    private String tokenHash;

    @Column(name = "expires_at" ,nullable = false)
    private OffsetDateTime expiresAt;

    @Column(name = "revoked_at",nullable = true)
    private OffsetDateTime revokedAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    public boolean isRevoked(){
        return revokedAt != null;
    }

    public boolean isExpired(OffsetDateTime now){
        return expiresAt.isBefore(now);
    }

    public void revoke(OffsetDateTime now){
        if(revokedAt == null){
            revokedAt = now;
        }
    }

}
