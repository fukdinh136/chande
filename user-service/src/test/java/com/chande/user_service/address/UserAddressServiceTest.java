package com.chande.user_service.address;

import com.chande.user_service.address.dto.AddressRequest;
import com.chande.user_service.address.dto.AddressResponse;
import com.chande.user_service.common.exception.ApiException;
import com.chande.user_service.common.exception.ErrorCode;
import com.chande.user_service.user.User;
import com.chande.user_service.user.UserRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class UserAddressServiceTest {

    @Mock
    private UserAddressRepository addressRepository;

    @Mock
    private UserRepository userRepository;

    @InjectMocks
    private UserAddressService service;

    private final UUID userId = UUID.randomUUID();

    private AddressRequest request(Boolean makeDefault) {
        return new AddressRequest("  Nhà  ", "  144 Xuân Thủy, Cầu Giấy  ",
                new BigDecimal("21.0368123456789"), new BigDecimal("105.782"), makeDefault);
    }

    private UserAddress stored(boolean isDefault) {
        UserAddress a = new UserAddress();
        a.setId(UUID.randomUUID());
        a.setAddressText("Địa chỉ cũ");
        a.setLat(new BigDecimal("21.00000000"));
        a.setLng(new BigDecimal("105.00000000"));
        a.setDefaultAddress(isDefault);
        return a;
    }

    // ---------- create ----------

    @Test
    void create_firstAddress_becomesDefaultAndIsNormalized() {
        when(addressRepository.countByUserId(userId)).thenReturn(0L);
        when(userRepository.getReferenceById(userId)).thenReturn(new User());
        when(addressRepository.save(any(UserAddress.class))).thenAnswer(inv -> inv.getArgument(0));

        AddressResponse res = service.create(userId, request(null));

        assertThat(res.isDefault()).isTrue();
        assertThat(res.label()).isEqualTo("Nhà");
        assertThat(res.addressText()).isEqualTo("144 Xuân Thủy, Cầu Giấy");
        assertThat(res.lat()).isEqualByComparingTo("21.03681235");
        assertThat(res.lat().scale()).isEqualTo(8);
        verify(addressRepository).clearDefaultByUserId(userId);
    }

    @Test
    void create_secondAddressWithoutFlag_isNotDefault() {
        when(addressRepository.countByUserId(userId)).thenReturn(2L);
        when(userRepository.getReferenceById(userId)).thenReturn(new User());
        when(addressRepository.save(any(UserAddress.class))).thenAnswer(inv -> inv.getArgument(0));

        AddressResponse res = service.create(userId, request(null));

        assertThat(res.isDefault()).isFalse();
        verify(addressRepository, never()).clearDefaultByUserId(any());
    }

    @Test
    void create_limitReached_throws() {
        when(addressRepository.countByUserId(userId)).thenReturn(10L);

        ApiException ex = assertThrows(ApiException.class, () -> service.create(userId, request(null)));

        assertThat(ex.getErrorCode()).isEqualTo(ErrorCode.ADDRESS_LIMIT_REACHED);
        verify(addressRepository, never()).save(any());
    }

    // ---------- update ----------

    @Test
    void update_withMakeDefault_clearsBeforeLoadingAndAppliesFields() {
        UserAddress address = stored(false);
        when(addressRepository.findByIdAndUserId(address.getId(), userId)).thenReturn(Optional.of(address));

        AddressResponse res = service.update(userId, address.getId(), request(true));

        assertThat(res.isDefault()).isTrue();
        assertThat(res.label()).isEqualTo("Nhà");
        assertThat(res.lng()).isEqualByComparingTo("105.782");
        assertThat(res.lng().scale()).isEqualTo(8);

        InOrder inOrder = inOrder(addressRepository);
        inOrder.verify(addressRepository).clearDefaultByUserId(userId);
        inOrder.verify(addressRepository).findByIdAndUserId(address.getId(), userId);
        verify(addressRepository, never()).save(any());
    }

    // ---------- setDefault ----------

    @Test
    void setDefault_clearsOthersBeforeLoadingTarget() {
        UserAddress target = stored(false);
        when(addressRepository.findByIdAndUserId(target.getId(), userId)).thenReturn(Optional.of(target));

        AddressResponse res = service.setDefault(userId, target.getId());

        assertThat(res.isDefault()).isTrue();
        InOrder inOrder = inOrder(addressRepository);
        inOrder.verify(addressRepository).clearDefaultByUserId(userId);
        inOrder.verify(addressRepository).findByIdAndUserId(target.getId(), userId);
    }

    @Test
    void setDefault_addressOfAnotherUser_throwsNotFound() {
        when(addressRepository.findByIdAndUserId(any(), eq(userId))).thenReturn(Optional.empty());

        ApiException ex = assertThrows(ApiException.class,
                () -> service.setDefault(userId, UUID.randomUUID()));

        assertThat(ex.getErrorCode()).isEqualTo(ErrorCode.ADDRESS_NOT_FOUND);
    }

    // ---------- delete ----------

    @Test
    void delete_defaultAddress_promotesNewestRemaining() {
        UserAddress oldDefault = stored(true);
        UserAddress next = stored(false);
        when(addressRepository.findByIdAndUserId(oldDefault.getId(), userId)).thenReturn(Optional.of(oldDefault));
        when(addressRepository.findFirstByUserIdOrderByCreatedAtDesc(userId)).thenReturn(Optional.of(next));

        service.delete(userId, oldDefault.getId());

        assertThat(next.isDefaultAddress()).isTrue();
        InOrder inOrder = inOrder(addressRepository);
        inOrder.verify(addressRepository).delete(oldDefault);
        inOrder.verify(addressRepository).flush();
        inOrder.verify(addressRepository).findFirstByUserIdOrderByCreatedAtDesc(userId);
    }

    @Test
    void delete_nonDefaultAddress_doesNotPromote() {
        UserAddress address = stored(false);
        when(addressRepository.findByIdAndUserId(address.getId(), userId)).thenReturn(Optional.of(address));

        service.delete(userId, address.getId());

        verify(addressRepository).delete(address);
        verify(addressRepository, never()).findFirstByUserIdOrderByCreatedAtDesc(any());
    }
}