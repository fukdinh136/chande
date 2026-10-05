package com.chande.userservice.application;

import com.chande.userservice.application.address.AddressCommand;
import com.chande.userservice.application.auth.ChangePasswordCommand;
import com.chande.userservice.application.auth.LoginCommand;
import com.chande.userservice.application.auth.RefreshCommand;
import com.chande.userservice.application.auth.RegisterCommand;
import com.chande.userservice.application.profile.UpdateProfileCommand;
import com.chande.userservice.domain.common.ValidationException;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

class CommandValidationTest {

    private static Map<String, String> errors(ThrowingCallable create) {
        ValidationException e = catchThrowableOfType(ValidationException.class, create);
        assertThat(e).as("expected ValidationException").isNotNull();
        return e.fieldErrors();
    }

    @Nested
    class Register {

        @Test
        void validCommand() {
            assertThatCode(() -> new RegisterCommand("091 234 5678", "matkhau123", "  Nguyễn Văn A  "))
                    .doesNotThrowAnyException();
        }

        @Test
        void allFieldsMissing() {
            assertThat(errors(() -> new RegisterCommand(null, null, null))).containsExactly(
                    Map.entry("phoneNumber", "Số điện thoại không được để trống"),
                    Map.entry("password", "Mật khẩu không được để trống"),
                    Map.entry("fullName", "Họ tên không được để trống"));
        }

        @Test
        void blankPasswordReportsRequiredNotLength() {
            assertThat(errors(() -> new RegisterCommand("0912345678", "   ", "A")))
                    .containsExactly(Map.entry("password", "Mật khẩu không được để trống"));
        }

        @Test
        void passwordRules() {
            assertThat(errors(() -> new RegisterCommand("0912345678", "abc12", "A")))
                    .containsEntry("password", "Mật khẩu phải từ 8 đến 72 ký tự");
            assertThat(errors(() -> new RegisterCommand("0912345678", "a1".repeat(37), "A")))
                    .containsEntry("password", "Mật khẩu phải từ 8 đến 72 ký tự");
            assertThat(errors(() -> new RegisterCommand("0912345678", "matkhaudai", "A")))
                    .containsEntry("password", "Mật khẩu phải có cả chữ và số");
            assertThat(errors(() -> new RegisterCommand("0912345678", "12345678", "A")))
                    .containsEntry("password", "Mật khẩu phải có cả chữ và số");
            assertThatCode(() -> new RegisterCommand("0912345678", "a1".repeat(36), "A")).doesNotThrowAnyException();
        }

        @Test
        void passwordOver72BytesIsRejectedEvenWhenUnder72Chars() {
            String password = "mậtkhẩu1" + "ệ".repeat(30); // 38 ký tự, > 72 byte
            assertThat(errors(() -> new RegisterCommand("0912345678", password, "A")))
                    .containsEntry("password", "Mật khẩu quá dài (tối đa 72 byte, chữ có dấu tính 2–3 byte)");
        }

        @Test
        void lengthLimitsUseOriginalValue() {
            assertThat(errors(() -> new RegisterCommand("0".repeat(21), "matkhau123", "x".repeat(101))))
                    .containsExactly(Map.entry("phoneNumber", "Số điện thoại quá dài"),
                            Map.entry("fullName", "Họ tên tối đa 100 ký tự"));
        }

        @Test
        void toStringHidesPassword() {
            assertThat(new RegisterCommand("0912345678", "matkhau123", "A").toString()).doesNotContain("matkhau123");
        }
    }

    @Nested
    class Login {

        @Test
        void noMinimumPasswordLength() {
            assertThatCode(() -> new LoginCommand("0912345678", "x")).doesNotThrowAnyException();
        }

        @Test
        void rules() {
            assertThat(errors(() -> new LoginCommand("", ""))).containsExactly(
                    Map.entry("phoneNumber", "Số điện thoại không được để trống"),
                    Map.entry("password", "Mật khẩu không được để trống"));
            assertThat(errors(() -> new LoginCommand("0912345678", "x".repeat(73))))
                    .containsExactly(Map.entry("password", "Mật khẩu quá dài"));
        }
    }

    @Nested
    class Refresh {

        @Test
        void rules() {
            assertThat(errors(() -> new RefreshCommand(" ")))
                    .containsExactly(Map.entry("refreshToken", "Refresh token không được để trống"));
            assertThat(errors(() -> new RefreshCommand("x".repeat(201))))
                    .containsExactly(Map.entry("refreshToken", "Refresh token không hợp lệ"));
            assertThatCode(() -> new RefreshCommand("x".repeat(200))).doesNotThrowAnyException();
        }
    }

    @Nested
    class ChangePassword {

        @Test
        void rules() {
            assertThat(errors(() -> new ChangePasswordCommand(null, null))).containsExactly(
                    Map.entry("oldPassword", "Vui lòng nhập mật khẩu hiện tại"),
                    Map.entry("newPassword", "Vui lòng nhập mật khẩu mới"));
            assertThat(errors(() -> new ChangePasswordCommand("x".repeat(73), "short1")))
                    .containsExactly(Map.entry("oldPassword", "Mật khẩu tối đa 72 ký tự"),
                            Map.entry("newPassword", "Mật khẩu mới phải từ 8 đến 72 ký tự"));
            assertThat(errors(() -> new ChangePasswordCommand("old", "khongcoso")))
                    .containsExactly(Map.entry("newPassword", "Mật khẩu mới phải có cả chữ và số"));
        }
    }

    @Nested
    class UpdateProfile {

        @Test
        void allNullIsValid() {
            assertThatCode(() -> new UpdateProfileCommand(null, null)).doesNotThrowAnyException();
        }

        @Test
        void rules() {
            assertThat(errors(() -> new UpdateProfileCommand("   ", "ftp://x"))).containsExactly(
                    Map.entry("fullName", "Họ tên không được để trống"),
                    Map.entry("avatarUrl", "URL ảnh phải bắt đầu bằng http:// hoặc https://"));
            assertThat(errors(() -> new UpdateProfileCommand("x".repeat(101), "https://" + "a".repeat(493))))
                    .containsExactly(Map.entry("fullName", "Họ tên tối đa 100 ký tự"),
                            Map.entry("avatarUrl", "URL ảnh tối đa 500 ký tự"));
            // Không xoá được avatar: "" sai mẫu URL (giới hạn của v1, giữ nguyên)
            assertThat(errors(() -> new UpdateProfileCommand(null, "")))
                    .containsExactly(Map.entry("avatarUrl", "URL ảnh phải bắt đầu bằng http:// hoặc https://"));
            assertThatCode(() -> new UpdateProfileCommand(" B ", "https://cdn.example.com/a.png"))
                    .doesNotThrowAnyException();
        }
    }

    @Nested
    class Address {

        @Test
        void valid() {
            assertThatCode(() -> new AddressCommand(null, "Keangnam", new BigDecimal("21.017"),
                    new BigDecimal("105.784"), null)).doesNotThrowAnyException();
        }

        @Test
        void missingFields() {
            assertThat(errors(() -> new AddressCommand(null, " ", null, null, true))).containsExactly(
                    Map.entry("addressText", "Địa chỉ không được để trống"),
                    Map.entry("lat", "Thiếu vĩ độ"),
                    Map.entry("lng", "Thiếu kinh độ"));
        }

        @Test
        void ranges() {
            assertThat(errors(() -> new AddressCommand("x".repeat(51), "x".repeat(501), new BigDecimal("90.0000000001"),
                    new BigDecimal("-180.1"), null))).containsExactly(
                    Map.entry("label", "Tên gợi nhớ tối đa 50 ký tự"),
                    Map.entry("addressText", "Địa chỉ tối đa 500 ký tự"),
                    Map.entry("lat", "Vĩ độ phải từ -90 đến 90"),
                    Map.entry("lng", "Kinh độ phải từ -180 đến 180"));
            assertThatCode(() -> new AddressCommand(null, "x", new BigDecimal("-90"), new BigDecimal("180"), null))
                    .doesNotThrowAnyException();
        }
    }
}
