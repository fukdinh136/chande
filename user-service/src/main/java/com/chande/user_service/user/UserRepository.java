package com.chande.user_service.user;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;


public interface UserRepository extends JpaRepository<User, UUID> {

    // Dùng khi ĐĂNG NHẬP: tìm user theo SĐT
    // Spring tự sinh: SELECT * FROM users WHERE phone_number = ?
    // Trả Optional để bắt buộc người gọi xử lý trường hợp không tìm thấy
    Optional<User> findByPhoneNumber(String phoneNumber);

    // Dùng khi ĐĂNG KÝ: kiểm tra SĐT đã có người dùng chưa
    // Spring tự sinh: SELECT count(*) > 0 FROM users WHERE phone_number = ?
    // Nhanh hơn findBy... vì không phải tải cả dòng dữ liệu
    boolean existsByPhoneNumber(String phoneNumber);
}