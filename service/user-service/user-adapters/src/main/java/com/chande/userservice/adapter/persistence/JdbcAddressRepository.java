package com.chande.userservice.adapter.persistence;

import com.chande.userservice.application.port.AddressRepository;
import com.chande.userservice.domain.address.Address;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static com.chande.userservice.adapter.persistence.JdbcSupport.getInstant;
import static com.chande.userservice.adapter.persistence.JdbcSupport.getUuid;
import static com.chande.userservice.adapter.persistence.JdbcSupport.setInstant;

public final class JdbcAddressRepository implements AddressRepository {

    private static final String COLUMNS = "id, user_id, label, address_text, lat, lng, is_default, created_at";

    private final ConnectionProvider db;

    public JdbcAddressRepository(ConnectionProvider db) {
        this.db = db;
    }

    @Override
    public List<Address> listByUser(UUID userId) {
        return db.withConnection(c -> {
            try (PreparedStatement ps = c.prepareStatement("SELECT " + COLUMNS
                    + " FROM user_addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC")) {
                ps.setObject(1, userId);
                try (ResultSet rs = ps.executeQuery()) {
                    List<Address> result = new ArrayList<>();
                    while (rs.next()) {
                        result.add(map(rs));
                    }
                    return result;
                }
            }
        });
    }

    @Override
    public Optional<Address> findOwned(UUID userId, UUID addressId) {
        return db.withConnection(c -> {
            try (PreparedStatement ps = c.prepareStatement(
                    "SELECT " + COLUMNS + " FROM user_addresses WHERE id = ? AND user_id = ?")) {
                ps.setObject(1, addressId);
                ps.setObject(2, userId);
                return single(ps);
            }
        });
    }

    @Override
    public long countByUser(UUID userId) {
        return db.withConnection(c -> {
            try (PreparedStatement ps = c.prepareStatement("SELECT count(*) FROM user_addresses WHERE user_id = ?")) {
                ps.setObject(1, userId);
                try (ResultSet rs = ps.executeQuery()) {
                    rs.next();
                    return rs.getLong(1);
                }
            }
        });
    }

    @Override
    public Optional<Address> findNewest(UUID userId) {
        return db.withConnection(c -> {
            try (PreparedStatement ps = c.prepareStatement("SELECT " + COLUMNS
                    + " FROM user_addresses WHERE user_id = ? ORDER BY created_at DESC LIMIT 1")) {
                ps.setObject(1, userId);
                return single(ps);
            }
        });
    }

    @Override
    public int clearDefault(UUID userId) {
        return db.withConnection(c -> {
            try (PreparedStatement ps = c.prepareStatement(
                    "UPDATE user_addresses SET is_default = false WHERE user_id = ? AND is_default")) {
                ps.setObject(1, userId);
                return ps.executeUpdate();
            }
        });
    }

    @Override
    public void insert(Address address) {
        db.withConnection(c -> {
            try (PreparedStatement ps = c.prepareStatement(
                    "INSERT INTO user_addresses (" + COLUMNS + ") VALUES (?, ?, ?, ?, ?, ?, ?, ?)")) {
                ps.setObject(1, address.id());
                ps.setObject(2, address.userId());
                ps.setString(3, address.label());
                ps.setString(4, address.addressText());
                ps.setBigDecimal(5, address.lat());
                ps.setBigDecimal(6, address.lng());
                ps.setBoolean(7, address.isDefault());
                setInstant(ps, 8, address.createdAt());
                return ps.executeUpdate();
            }
        });
    }

    @Override
    public void update(Address address) {
        db.withConnection(c -> {
            try (PreparedStatement ps = c.prepareStatement("UPDATE user_addresses "
                    + "SET label = ?, address_text = ?, lat = ?, lng = ?, is_default = ? WHERE id = ?")) {
                ps.setString(1, address.label());
                ps.setString(2, address.addressText());
                ps.setBigDecimal(3, address.lat());
                ps.setBigDecimal(4, address.lng());
                ps.setBoolean(5, address.isDefault());
                ps.setObject(6, address.id());
                return ps.executeUpdate();
            }
        });
    }

    @Override
    public void delete(UUID addressId) {
        db.withConnection(c -> {
            try (PreparedStatement ps = c.prepareStatement("DELETE FROM user_addresses WHERE id = ?")) {
                ps.setObject(1, addressId);
                return ps.executeUpdate();
            }
        });
    }

    private static Optional<Address> single(PreparedStatement ps) throws SQLException {
        try (ResultSet rs = ps.executeQuery()) {
            return rs.next() ? Optional.of(map(rs)) : Optional.empty();
        }
    }

    private static Address map(ResultSet rs) throws SQLException {
        return Address.restore(
                getUuid(rs, "id"),
                getUuid(rs, "user_id"),
                rs.getString("label"),
                rs.getString("address_text"),
                rs.getBigDecimal("lat"),
                rs.getBigDecimal("lng"),
                rs.getBoolean("is_default"),
                getInstant(rs, "created_at"));
    }
}
